# `@softmaple/collab`

Standalone Nitro WebSocket service for Softmaple document sync and presence.

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness / readiness |
| `WS /ws/document` | Protocol v2 document event sync (auth in first frame) |
| `WS /ws/presence?roomId=` | Ephemeral awareness (not persisted) |

## Environment

See `.env.example`. Dev auth bypass (`COLLAB_DEV_AUTH_BYPASS=true`) is honored only when `NODE_ENV=development`. Tokens may be `dev:<userId>` (or legacy `dev:<userId>:<ROLE>`); the role is always loaded from `workspaceMember`, never from the token.

## Deployment (v1)

Realtime fan-out is in-process (no CrossWS sync backplane yet). Run a **single instance** or sticky-session routing so document/presence peers share one process. Multi-replica broadcast requires a supported CrossWS backplane.

## Development

```bash
pnpm --filter @softmaple/collab dev
```

Postgres is the sole durable store (`document_event_batches` / `document_event_ids`). Broadcast and `durable-ack` happen only after a successful transaction commit.
