# `@softmaple/collab-gateway-auth`

Server-only HMAC authentication shared by the Next.js collaboration gateway
and the Nitro collaboration service. It authenticates a WebSocket upgrade as
having passed through the trusted web gateway; it does not authenticate the
user or authorize access to a document.

The canonical payload is UTF-8 with LF separators and no trailing newline.
The sixth field is the backend upgrade target (pathname plus query):

```text
softmaple-collab-upgrade-v1
${keyId}
${timestamp}
${nonce}
GET
${pathname}${search}
${secWebSocketKey}
```

Document upgrades use `/document`. Presence upgrades use
`/presence?roomId=<document-uuid>`. The verifier rejects a signature whose
bound target does not exactly match the request URL.

Secrets are exactly 32 bytes encoded as unpadded base64url. Signatures use
HMAC-SHA-256, nonces contain 16 random bytes, and verification accepts a
±30-second clock window. The keyring supports current and previous keys for
zero-downtime rotation.

This package depends on Node.js cryptography and must never be imported into a
Client Component or browser bundle. User authentication remains in
`apps/collab/server/utils/auth.ts`, which verifies the Supabase access token
and workspace membership after the upgrade succeeds.
