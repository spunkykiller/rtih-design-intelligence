# WhatsApp Notification Setup

Status: scaffolded, waiting for a sending channel.

The repo includes `scripts/notify-whatsapp.mjs`, which can send push or roadblock updates through any WhatsApp-capable webhook provider.

## Required Local Environment

Set these locally, not in git:

```bash
export WHATSAPP_WEBHOOK_URL="https://your-whatsapp-provider-webhook"
export WHATSAPP_WEBHOOK_TOKEN="optional-provider-token"
export WHATSAPP_TO="+91..."
```

## Events

```bash
node scripts/notify-whatsapp.mjs push "Pushed RTIH research update to GitHub."
node scripts/notify-whatsapp.mjs roadblock "Roadblock: describe the issue."
```

## Current Limitation

WhatsApp does not support unauthenticated arbitrary shell messages. A provider such as WhatsApp Business Cloud API, Twilio WhatsApp, a private webhook bridge, or an approved logged-in WhatsApp Web workflow is required before messages can actually be delivered.

Secrets must remain local environment variables or provider-side configuration.
