# `@softmaple/collab`

Standalone Nitro WebSocket service for Softmaple document sync and presence.

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness / readiness |
| `WS /ws/document` | Protocol v2 document event sync (auth in first frame) |
| `WS /ws/presence?roomId=` | Ephemeral awareness (not persisted) |

## Environment

See `.env.example`. Set `COLLAB_DEV_AUTH_BYPASS=true` only for local playground testing with tokens shaped like `dev:<userId>:<OWNER|EDITOR|VIEWER>`.

## Development

```bash
pnpm --filter @softmaple/collab dev
```

Postgres is the sole durable store (`document_event_batches` / `document_event_ids`). Broadcast and `durable-ack` happen only after a successful transaction commit.
