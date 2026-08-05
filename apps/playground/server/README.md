# Collaboration WebSocket servers

Playground Nitro handlers that back Lexical EG-walker and the textarea
online-collab demos.

| Endpoint | Protocol | Clients |
|---|---|---|
| `/api/collab-doc?roomId=` | Persistence channel (`event` / `repair-*` / `durable-ack`) | Lexical EG-walker demo |
| `/api/presence?roomId=` | Awareness WebSocket frames | Lexical EG-walker presence |
| `/api/collab-sync` | Textarea `SyncMessage` relay | `/demo/online-collab-editor` |

## Enablement

`vite.config.ts` turns on Nitro WebSockets:

```ts
nitro({
  serverDir: "./server",
  features: { websocket: true },
})
```

## Client transport

By default demos connect to same-origin `ws://` / `wss://` endpoints.
Override with:

- `?transport=broadcast` — BroadcastChannel only (tabs on one origin)
- `?transport=websocket` — force WebSocket (default)
- `VITE_COLLAB_TRANSPORT`, `VITE_COLLAB_DOC_WS_URL`,
  `VITE_COLLAB_PRESENCE_WS_URL`, `VITE_COLLAB_SYNC_WS_URL`

## Demo

Open `/demo/lexical-eg-walker` in two browsers with the same `?room=` id.
Document batches and presence ride the WebSocket servers above; each browser
also keeps a local durable copy in `localStorage`.
