# pi-messenger-bridge

Bridge common messengers (Telegram, WhatsApp, Slack, Discord, Matrix) into pi.

Remote users can interact with your pi coding agent via their messenger app.

<img width="887" height="656" alt="image" src="https://github.com/user-attachments/assets/d42a41e5-e7d5-420b-be8e-f2191facb190" />

https://github.com/user-attachments/assets/cd64360e-e8cd-4820-a67f-bd127c5d6035

## Features

- 🔐 Challenge-based authentication (6-digit codes)
- 📱 Multi-messenger support (Telegram, WhatsApp, Slack, Discord, Matrix)
- 🔐 End-to-end encryption support (Matrix via Rust/WASM crypto)
- 🎯 Event-driven architecture (no polling loops)
- 🔒 Trusted user management with transport-namespaced IDs
- 📊 Live status widget (toggleable)
- 💾 Persistent config (auth state, auto-connect, widget preference)
- 🔧 Tool call visibility for remote users
- 📝 Multi-turn conversation support
- 🔑 Secure permissions (chmod 600 for config files, 700 for directories)
- 🐛 Debug mode for troubleshooting

## Setup

### 1. Install

```bash
pi install npm:pi-messenger-bridge
```

### 2. Configure Transports

#### Telegram

Create a bot via [@BotFather](https://t.me/BotFather) and get your token.

```bash
/msg-bridge configure telegram <bot-token>
```

Or set via environment variable:
```bash
export PI_TELEGRAM_TOKEN="your-bot-token-here"
```

#### WhatsApp

Configure WhatsApp (requires QR code scan):

```bash
/msg-bridge configure whatsapp
```

Scan the QR code with WhatsApp mobile app (Linked Devices).

Or set custom auth path:
```bash
export PI_WHATSAPP_AUTH_PATH="/path/to/whatsapp-auth"
```

#### Slack

Create a Slack app with Socket Mode enabled. You need both tokens:

```bash
/msg-bridge configure slack <bot-token> <app-token>
```

Or set via environment variables:
```bash
export PI_SLACK_BOT_TOKEN="xoxb-..."
export PI_SLACK_APP_TOKEN="xapp-..."
```

#### Discord

Create a Discord bot in the [Developer Portal](https://discord.com/developers/applications).
Enable "Message Content Intent" in Bot settings.

```bash
/msg-bridge configure discord <bot-token>
```

Or set via environment variable:
```bash
export PI_DISCORD_TOKEN="your-bot-token"
```

#### Matrix (Element X, Element Web, FluffyChat, etc.)

Create a Matrix account for your bot, then get an access token.
The simplest way is to log into [Element Web](https://app.element.io), then go to
Settings → Help & About → Access Token.

```bash
/msg-bridge configure matrix https://matrix.org <access-token>
```

Or set via environment variables:
```bash
export PI_MATRIX_HOMESERVER="https://matrix.org"
export PI_MATRIX_ACCESS_TOKEN="your-access-token"
# Optional: pin user ID and device ID
export PI_MATRIX_USER_ID="@yourbot:matrix.org"
export PI_MATRIX_DEVICE_ID="PI_BRIDGE"
```

**E2EE support:** The Matrix transport uses `matrix-js-sdk` with Rust/WASM crypto,
so it can send and receive messages in encrypted rooms. Crypto keys are ephemeral
(in-memory only in Node.js) — a new device is created on each restart. This is fine
for a bot that only processes live messages.

**Note:** The bot auto-joins any room it's invited to.

### 3. Connect

```bash
/msg-bridge connect
```

### 4. Authenticate Users

When a user messages your bot for the first time, they'll receive a 6-digit challenge code.
The code is displayed in your pi terminal. Share it with the user (e.g., via DM).

The user enters the code in the bot chat to become a trusted user.

## Commands

- `/msg-bridge` or `/msg-bridge help` — Show available commands
- `/msg-bridge status` — Show connection and user status
- `/msg-bridge connect` — Connect to configured messengers
- `/msg-bridge disconnect` — Disconnect all transports
- `/msg-bridge configure <platform> <token>` — Set transport credentials
- `/msg-bridge widget` — Toggle status widget on/off

## Configuration

Config is stored at `~/.pi/msg-bridge.json` with secure permissions (chmod 600).

Example config:
```json
{
  "telegram": { "token": "..." },
  "whatsapp": { "authPath": "..." },
  "slack": { "botToken": "...", "appToken": "..." },
  "discord": { "token": "..." },
  "matrix": { "homeserverUrl": "https://matrix.org", "accessToken": "..." },
  "auth": {
    "trustedUsers": ["telegram:123", "whatsapp:456"],
    "adminUserId": "telegram:789"
  },
  "autoConnect": true,
  "showWidget": true,
  "debug": false
}
```

## Environment Variables

Environment variables override file config:

- `PI_TELEGRAM_TOKEN` — Telegram bot token
- `PI_WHATSAPP_AUTH_PATH` — WhatsApp session directory (default: `~/.pi/msg-bridge-whatsapp-auth`)
- `PI_SLACK_BOT_TOKEN` — Slack bot token (xoxb-...)
- `PI_SLACK_APP_TOKEN` — Slack app token (xapp-...)
- `PI_DISCORD_TOKEN` — Discord bot token
- `PI_MATRIX_HOMESERVER` — Matrix homeserver URL (e.g., `https://matrix.org`)
- `PI_MATRIX_ACCESS_TOKEN` — Matrix access token
- `PI_MATRIX_USER_ID` — (optional) Matrix user ID (auto-detected if omitted)
- `PI_MATRIX_DEVICE_ID` — (optional) Matrix device ID
- `MSG_BRIDGE_DEBUG` — Enable debug logging (true/false)

## Security

- Config file: `~/.pi/msg-bridge.json` (chmod 600 - owner read/write only)
- Config directory: `~/.pi/` (chmod 700 - owner only)
- WhatsApp auth: `~/.pi/msg-bridge-whatsapp-auth/` (chmod 700 - owner only)
- Environment variables take precedence over config file
- Challenge-based authentication for all new users
- Transport-namespaced user IDs prevent impersonation

## Troubleshooting

Enable debug mode to see detailed logs:

```json
{
  "debug": true
}
```

Or:
```bash
export MSG_BRIDGE_DEBUG=true
```

## Architecture

Uses pi's native `sendUserMessage()` and `turn_end` events for two-way communication.
No tool-loop hacks needed — this is the pi-native way.

## License

MIT
