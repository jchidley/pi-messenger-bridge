import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  clients: [] as any[],
  loggers: [] as any[],
  getUserId: vi.fn(),
  start: vi.fn(),
  getJoinedRooms: vi.fn(),
  getJoinedRoomMembers: vi.fn(),
  setLogger: vi.fn(),
  setupOnClient: vi.fn(),
}));

vi.mock("matrix-bot-sdk", () => ({
  AutojoinRoomsMixin: { setupOnClient: sdk.setupOnClient },
  LogService: { setLogger: sdk.setLogger },
  MatrixClient: class {
    getUserId = (...args: unknown[]) => sdk.getUserId(...args);
    start = (...args: unknown[]) => sdk.start(...args);
    getJoinedRooms = (...args: unknown[]) => sdk.getJoinedRooms(...args);
    getJoinedRoomMembers = (...args: unknown[]) => sdk.getJoinedRoomMembers(...args);
    on = vi.fn();
    stop = vi.fn();

    constructor() {
      sdk.clients.push(this);
    }
  },
  RichConsoleLogger: class {
    info = vi.fn();
    warn = vi.fn();
    debug = vi.fn();
    trace = vi.fn();
    error = vi.fn();

    constructor() {
      sdk.loggers.push(this);
    }
  },
  RustSdkCryptoStorageProvider: class {},
  RustSdkCryptoStoreType: { Sqlite: "sqlite" },
  SimpleFsStorageProvider: class {},
}));

import type { ChallengeAuth } from "../auth/challenge-auth.js";
import { MatrixProvider } from "./matrix.js";

function createProvider(): MatrixProvider {
  return new MatrixProvider(
    { homeserverUrl: "https://matrix.example", accessToken: "token", encryption: false },
    {} as ChallengeAuth
  );
}

function expectReset(provider: MatrixProvider): void {
  const state = provider as unknown as {
    client?: unknown;
    botUserId?: string;
    joinedRooms: Set<string>;
    roomMemberCount: Map<string, number>;
    connectedAt: number;
  };

  expect(provider.isConnected).toBe(false);
  expect(state.client).toBeUndefined();
  expect(state.botUserId).toBeUndefined();
  expect(state.joinedRooms.size).toBe(0);
  expect(state.roomMemberCount.size).toBe(0);
  expect(state.connectedAt).toBe(0);
}

describe("MatrixProvider connection lifecycle", () => {
  beforeEach(() => {
    sdk.clients.length = 0;
    sdk.loggers.length = 0;
    sdk.getUserId.mockReset().mockResolvedValue("@bot:matrix.example");
    sdk.start.mockReset().mockResolvedValue(undefined);
    sdk.getJoinedRooms.mockReset().mockResolvedValue([]);
    sdk.getJoinedRoomMembers.mockReset().mockResolvedValue([]);
    sdk.setLogger.mockReset();
    sdk.setupOnClient.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cleans up and permits retry when user ID lookup fails", async () => {
    const provider = createProvider();
    const failure = new Error("user lookup failed");
    sdk.getUserId.mockRejectedValueOnce(failure);

    await expect(provider.connect()).rejects.toBe(failure);

    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expectReset(provider);

    await provider.connect();
    expect(provider.isConnected).toBe(true);
    expect(sdk.clients).toHaveLength(2);
  });

  it("restores logging and cleans up when initial sync fails", async () => {
    const provider = createProvider();
    const failure = new Error("sync failed");
    sdk.start.mockRejectedValueOnce(failure);

    await expect(provider.connect()).rejects.toBe(failure);

    expect(sdk.setLogger).toHaveBeenCalledTimes(2);
    expect(sdk.setLogger).toHaveBeenLastCalledWith(sdk.loggers[0]);
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expectReset(provider);
  });

  it("stops and resets a started client when room seeding fails", async () => {
    const provider = createProvider();
    const failure = new Error("room lookup failed");
    sdk.getJoinedRooms.mockRejectedValueOnce(failure);

    await expect(provider.connect()).rejects.toBe(failure);

    expect(sdk.start).toHaveBeenCalledOnce();
    expect(sdk.setLogger).toHaveBeenLastCalledWith(sdk.loggers[0]);
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expectReset(provider);
  });
});
