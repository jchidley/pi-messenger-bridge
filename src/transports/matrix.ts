import * as sdk from "matrix-js-sdk";
import type { ITransportProvider } from "./interface.js";
import type { ExternalMessage } from "../types.js";
import type { ChallengeAuth } from "../auth/challenge-auth.js";

// Suppress matrix-js-sdk noisy fetch logging in Node.js
// The SDK logs every HTTP request at debug level by default
import loglevel from "loglevel";
loglevel.setLevel("warn");

/**
 * Matrix transport provider using matrix-js-sdk (official SDK)
 * Supports E2EE via Rust crypto (WASM). Works with Element X, Element Web,
 * FluffyChat, and any Matrix homeserver.
 */
export class MatrixProvider implements ITransportProvider {
  readonly type = "matrix";
  private client?: sdk.MatrixClient;
  private _isConnected = false;
  private messageHandler?: (message: ExternalMessage) => void;
  private errorHandler?: (error: Error) => void;
  private botUserId?: string;
  private connectedAt = 0;

  constructor(
    private config: { homeserverUrl: string; accessToken: string; userId?: string; deviceId?: string },
    private auth: ChallengeAuth
  ) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Convert standard markdown to Matrix HTML for rich formatting.
   * Matrix supports a subset of HTML in m.formatted_body.
   */
  private formatForMatrix(text: string): { body: string; formattedBody?: string } {
    const hasMarkdown = /[*_`#\[]/.test(text);
    if (!hasMarkdown) {
      return { body: text };
    }

    let html = text;

    // Protect code blocks
    const codeBlocks: string[] = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${this.escapeHtml(code.trimEnd())}</code></pre>`);
      return `__CODEBLOCK_${codeBlocks.length - 1}__`;
    });

    // Protect inline code
    const inlineCodes: string[] = [];
    html = html.replace(/`([^`]+)`/g, (_, code) => {
      inlineCodes.push(`<code>${this.escapeHtml(code)}</code>`);
      return `__INLINECODE_${inlineCodes.length - 1}__`;
    });

    // Bold
    html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Newlines to <br>
    html = html.replace(/\n/g, "<br>");

    // Restore code blocks and inline code
    html = html.replace(/__CODEBLOCK_(\d+)__/g, (_, idx) => codeBlocks[parseInt(idx)]);
    html = html.replace(/__INLINECODE_(\d+)__/g, (_, idx) => inlineCodes[parseInt(idx)]);

    return { body: text, formattedBody: html };
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    const { homeserverUrl, accessToken, userId, deviceId } = this.config;

    if (!homeserverUrl || !accessToken) {
      throw new Error("Matrix homeserver URL and access token required");
    }

    // Resolve userId if not provided (needed for crypto init)
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const tempClient = sdk.createClient({ baseUrl: homeserverUrl, accessToken });
      const whoami = await tempClient.whoami();
      resolvedUserId = whoami.user_id;
      tempClient.stopClient();
    }

    this.client = sdk.createClient({
      baseUrl: homeserverUrl,
      accessToken,
      userId: resolvedUserId,
      deviceId: deviceId,
      store: new sdk.MemoryStore(),
    });

    this.botUserId = resolvedUserId;

    // Initialize Rust crypto for E2EE support.
    // useIndexedDB: false → in-memory crypto store (no IndexedDB in Node.js).
    // Crypto keys are ephemeral: a new device is created on each restart.
    // This is acceptable for a bot that only processes live messages.
    try {
      await this.client.initRustCrypto({ useIndexedDB: false });
      console.log("[Matrix] E2EE crypto initialized (Rust/WASM, ephemeral keys)");
    } catch (err) {
      console.warn("[Matrix] E2EE crypto init failed, continuing without encryption:", (err as Error).message);
    }

    // Auto-join rooms on invite
    this.client.on(sdk.RoomEvent.MyMembership, (room, membership) => {
      if (membership === sdk.KnownMembership.Invite) {
        this.client!.joinRoom(room.roomId).then(() => {
          console.log(`[Matrix] Auto-joined ${room.roomId}`);
        }).catch((err) => {
          console.error(`[Matrix] Failed to auto-join ${room.roomId}:`, err.message);
        });
      }
    });

    // Handle incoming messages
    this.client.on(sdk.RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
      // Don't process paginated results
      if (toStartOfTimeline) return;

      // Only process message events
      if (event.getType() !== "m.room.message") return;

      try {
        await this.handleMessage(event, room ?? undefined);
      } catch (err) {
        if (this.errorHandler) {
          this.errorHandler(err as Error);
        }
      }
    });

    // Wait for initial sync to complete
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Initial sync timed out (60s)")), 60000);

        this.client!.once(sdk.ClientEvent.Sync, (state: string) => {
          clearTimeout(timeout);
          if (state === "PREPARED") {
            resolve();
          } else {
            reject(new Error(`Sync failed with state: ${state}`));
          }
        });

        this.client!.startClient({ initialSyncLimit: 0 });
      });
    } catch (error) {
      console.error("[Matrix] Failed to connect:", error);
      throw error;
    }

    this.connectedAt = Date.now();
    this._isConnected = true;

    const rooms = await this.client.getJoinedRooms();
    const crypto = this.client.getCrypto();
    const cryptoStatus = crypto ? "E2EE enabled" : "E2EE disabled";
    console.log(`✅ Matrix connected as ${this.botUserId} (${rooms.joined_rooms.length} rooms, ${cryptoStatus})`);
  }

  async disconnect(): Promise<void> {
    if (!this._isConnected || !this.client) return;

    this.client.stopClient();
    this._isConnected = false;
    this.client = undefined;
    this.botUserId = undefined;
    this.connectedAt = 0;
    console.log("[Matrix] Disconnected");
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error("Matrix client not connected");
    }

    const { body, formattedBody } = this.formatForMatrix(text);

    await this.client.sendEvent(chatId, "m.room.message" as any, {
      msgtype: "m.text",
      body,
      ...(formattedBody && {
        format: "org.matrix.custom.html",
        formatted_body: formattedBody,
      }),
    });
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.sendTyping(chatId, true, 10000);
    } catch {
      // Ignore typing indicator errors
    }
  }

  onMessage(handler: (message: ExternalMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  private async handleMessage(event: sdk.MatrixEvent, room?: sdk.Room): Promise<void> {
    if (!this.client || !this.botUserId) return;

    const sender = event.getSender();
    if (!sender) return;

    // Ignore own messages
    if (sender === this.botUserId) return;

    // Skip events from before this connection (stale replay from initial sync)
    const eventTs = event.getTs();
    if (eventTs < this.connectedAt) return;

    // Verify bot is in this room (uses local store, no API call)
    const roomId = event.getRoomId();
    if (!roomId) return;
    const localRoom = this.client.getRoom(roomId);
    if (!localRoom || localRoom.getMyMembership() !== "join") return;

    // Get decrypted content (matrix-js-sdk handles decryption automatically)
    const content = event.getContent();
    if (!content || content.msgtype !== "m.text" || !content.body) return;

    // Ignore edits
    if (content["m.new_content"]) return;

    const chatId = roomId;
    const userId = sender;
    const username = userId.replace(/^@/, "").replace(/:.*$/, "");
    const messageText = content.body;
    const messageId = event.getId() || "";

    // Determine if group chat
    let isGroupChat = false;
    if (room) {
      const members = room.getJoinedMembers();
      isGroupChat = members.length > 2;
    }

    // Check if bot was mentioned
    let wasMentioned = false;
    if (isGroupChat) {
      wasMentioned =
        messageText.includes(this.botUserId) ||
        messageText.toLowerCase().includes(this.botUserId.split(":")[0].substring(1).toLowerCase());
    }

    // Check authorization
    const sendMessageToUser = async (cId: string, text: string) => {
      await this.sendMessage(cId, text);
    };

    const isAuthorized = await this.auth.checkAuthorization(
      userId,
      chatId,
      username,
      isGroupChat,
      wasMentioned,
      sendMessageToUser,
      this.type
    );

    // Handle challenge codes and commands in DMs
    if (!isGroupChat && (messageText.startsWith("/") || messageText.match(/^\d{6}$/))) {
      const handled = await this.auth.handleAdminCommand(
        messageText,
        chatId,
        userId,
        async (text) => await this.sendMessage(chatId, text),
        this.type
      );
      if (handled) return;
    }

    if (!isAuthorized) return;

    // Strip bot mention from message
    let cleanContent = messageText;
    if (wasMentioned) {
      cleanContent = cleanContent
        .replace(new RegExp(this.botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
        .trim();
    }

    // Forward to message handler
    if (this.messageHandler && cleanContent) {
      const externalMessage: ExternalMessage = {
        chatId,
        transport: this.type,
        content: cleanContent,
        username,
        userId,
        timestamp: new Date(eventTs || Date.now()),
        messageId,
        isGroupChat,
        wasMentioned,
      };

      this.messageHandler(externalMessage);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
