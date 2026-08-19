# `@softmaple/db`

Schema, migrations, and the typed Postgres client for Softmaple. Prisma
migrations under [`prisma/migrations/`](./prisma/migrations) are the **single
source of truth** for tables, Supabase Auth triggers, RLS policies, Data API
grants, and the collaboration RPCs. There is no second schema definition
anywhere in the repo.

## Role in the stack

```text
       apps/web             apps/collab-nitro     apps/collab-cloudflare
      supabase-js             Prisma client             supabase-js
  anon / publishable          @softmaple/db            service_role
           │                        │                        │
           │                        │          append_document_event_batches
           │                        │            read_document_event_page
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    │
                           Supabase / Postgres
           users · workspaces · workspace_members · documents
               document_event_batches · document_event_ids
                                    ▲
                                    │
                      packages/db/prisma/migrations
             tables · triggers · RLS policies · grants · RPC
```

Three access paths, one schema:

| Consumer | Path | Authority |
| --- | --- | --- |
| `apps/web` | Supabase Data API | End-user JWT; RLS decides everything |
| `apps/collab-nitro` | Prisma over a pooled connection | Trusted service, authorizes in app code |
| `apps/collab-cloudflare` | Supabase RPC | `service_role`, restricted to two narrowly-scoped functions |

The Worker deliberately does not get table-level write access. It calls
`append_document_event_batches` / `read_document_event_page`, which re-implement
the same append and repair invariants inside the database, so both
collaboration runtimes produce byte-identical history.

## Schema

```text
users ──< workspace_members >── workspaces
  │                                  │
  └──────────< documents >───────────┘
                   │
                   └──< document_event_batches ──< document_event_ids
```

| Model | Table | Notes |
| --- | --- | --- |
| `User` | `users` | Mirrors `auth.users` via the `handle_new_user` trigger |
| `Workspace` | `workspaces` | Owned by a user; cascade-deletes its documents |
| `WorkspaceMember` | `workspace_members` | `OWNER` / `EDITOR` / `VIEWER` |
| `Document` | `documents` | `is_public` opens anonymous read access |
| `DocumentEventBatch` | `document_event_batches` | **Immutable** EG-walker history. Collaboration services are the only writers |
| `DocumentEventId` | `document_event_ids` | Document-wide uniqueness guard that catches a replica/session id collision before conflicting history reaches clients |

`document_event_batches` carries `payload_hash` and `parent_version` so a
replayed append is idempotent and a conflicting one is rejected rather than
silently accepted.

## Usage

```ts
import { createPrismaClient, type PrismaClient } from "@softmaple/db";

const prisma: PrismaClient = createPrismaClient(); // requires DATABASE_URL
```

The package also re-exports the generated Supabase `Database` / `Json` types
for `supabase-js` consumers:

```ts
import type { Database } from "@softmaple/db";

const supabase = createClient<Database>(url, key);
```

`createPrismaClient` throws when `DATABASE_URL` is unset rather than returning
a client that fails later at query time.

## Commands

```bash
pnpm --filter @softmaple/db db:generate   # regenerate the Prisma client
pnpm --filter @softmaple/db db:migrate    # create + apply a dev migration
pnpm --filter @softmaple/db db:deploy     # apply migrations (CI / production)
pnpm --filter @softmaple/db db:types      # regenerate Supabase Database types
pnpm --filter @softmaple/db build         # generate + compile to dist/
```

Regenerate the client after any schema change — a stale client is the usual
cause of a type error that looks like a bug elsewhere.

### Verification

```bash
pnpm --filter @softmaple/db db:verify:collab-security   # structure + grants
pnpm --filter @softmaple/db db:verify:core-behavior     # access matrix
pnpm --filter @softmaple/db db:clean                    # drop test data
```

`db:verify:collab-security` checks deployed structure and grants and is safe to
run anywhere. `db:verify:core-behavior` exercises the
Owner/Editor/Viewer/outsider/anonymous access matrix inside a transaction that
always rolls back — run it against an **isolated test project**, never
production.

## Adding a change

1. Edit [`prisma/schema.prisma`](./prisma/schema.prisma) and/or write the SQL.
2. `pnpm --filter @softmaple/db db:migrate` to create a forward migration.
3. Never edit an already-deployed migration, and never introduce a second
   schema source (loose `functions/`, `rls/`, or `triggers/` SQL) — those were
   deliberately folded into the migration ledger.
4. Re-run `db:generate` and the verification scripts.

## Layout

```text
packages/db/
├── prisma/
│   ├── schema.prisma          # models, enums, generator, datasource
│   └── migrations/            # forward-only ledger, source of truth
├── src/
│   ├── client.ts              # createPrismaClient (PrismaPg adapter)
│   ├── database.types.ts      # generated Supabase types
│   └── index.ts
└── supabase/
    ├── README.md              # deployment notes
    ├── cron/                  # optional operational helpers
    └── scripts/               # verification / cleanup SQL
```

## Related

- [`supabase/README.md`](./supabase/README.md) — deployment and verification detail
- [`docs/design/collaboration-consistency.md`](../../docs/design/collaboration-consistency.md) — durable-write invariants
- [`apps/collab-cloudflare/README.md`](../../apps/collab-cloudflare/README.md) — the RPC consumer
