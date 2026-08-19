# `@softmaple/binding-lexical`

The surface binding that connects a Lexical editor to a
[`@softmaple/block-model`](../block-model/README.md) replica. It is the only
place in the stack where Lexical types and the convergent document model meet:
the block model knows nothing about Lexical, and this package never reaches
past the block model into `@softmaple/eg-walker`.

## Role in the stack

```text
                        Lexical editor state
                                  │
                 registerUpdateListener — local edit
                                  │
                                  ▼
                       projectLexicalDocument
                     Lexical → ProjectedDocument
                                  │
                        toBlockDocumentInput
                                  │
                                  ▼
                         replica.transact(…)  ───►    RichTextEventBatch
                       @softmaple/block-model                 │
                                  ▲                           │
                          applyRemoteEvents ◄─────────────────┘
                                  │            from the collab host
                                  ▼
                     materializeLexicalDocument
                                  │
            editor.update(…, { tag: COLLABORATION_TAG })
                                  │
                                  ▼
                        Lexical editor state
```

The `COLLABORATION_TAG` on every remote-applied update is what breaks the
cycle: the update listener ignores tagged updates, so applying a remote batch
never re-projects itself back into a new local event.

| Concern | Owner |
| --- | --- |
| Lexical nodes, selection, DOM | Lexical + the host app |
| Lexical ↔ block projection, selection anchoring | **this package** |
| Blocks, marks, structure, convergence | `@softmaple/block-model` |
| Sequence CRDT and stable anchors | `@softmaple/eg-walker` |
| Transport, persistence, presence | `apps/*` and `@softmaple/awareness` |

## Usage

### React

```tsx
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { BlockReplica } from "@softmaple/block-model";

const replica = new BlockReplica(sessionId);

<LexicalComposer initialConfig={config}>
  <RichTextPlugin … />
  <LexicalEgWalkerPlugin
    replica={replica}
    enableEditingOnReady
    onBindingChange={setBinding}
    onSelectionChange={publishPresence}
    onError={reportError}
  />
</LexicalComposer>;
```

The plugin is a lifecycle wrapper only — it creates the binding on mount and
calls `destroy()` on unmount. All behavior lives in the framework-free core.

### Framework-free

```ts
import { createLexicalBinding } from "@softmaple/binding-lexical";

const binding = createLexicalBinding({ editor, replica });

// Remote batches arriving from the collaboration host.
binding.applyRemoteEvents(batches);

// Stable, wire-safe selection for presence.
const selection = binding.captureSelection();

binding.destroy();
```

## API

| Export | Purpose |
| --- | --- |
| `createLexicalBinding(options)` | Creates the binding; returns `LexicalBinding` |
| `LexicalEgWalkerPlugin` (`/react`) | React lifecycle wrapper around the above |
| `captureLogicalSelection` / `restoreLogicalSelection` | Block-id + offset selection, independent of Lexical node keys |
| `UnsupportedLexicalNodeError` | Thrown when a node type has no projection |

`LexicalBinding` members:

- `applyRemoteEvents(batches)` — integrate remote batches and re-materialize.
- `captureSelection()` — current selection as EG-walker anchors
  (`StableBlockSelection`), safe to send over the wire.
- `resolveSelection(selection)` — anchors back to a logical selection; throws
  on an invalid anchor.
- `tryResolveSelection(selection)` — the same, but answers
  `temporarily-unresolved` when an endpoint names an atom whose creating event
  has not been integrated yet. Use this for remote presence, which routinely
  races ahead of document events.
- `getBlockIndex()` — current `blockId ↔ NodeKey` maps.
- `destroy()` — unregister listeners.

## Projection scope

Blocks projected today: `paragraph`, `h1`–`h3`, `quote`, `code`,
`bullet-list`, `number-list`, `check-list`.

Marks projected today: `bold`, `italic`, `underline`, `strike`,
`inline-code`, `link`.

Anything else throws `UnsupportedLexicalNodeError` rather than silently
dropping content — a lost node in a convergent document is unrecoverable, so
the binding fails loudly and lets the host decide.

Lexical `NodeKey`s are process-local. They appear in `ProjectedBlock.sourceKey`
as transaction-local references only and are **never** written into the
collaborative document, so two clients never disagree about identity.

## Commands

```bash
pnpm --filter @softmaple/binding-lexical build
pnpm --filter @softmaple/binding-lexical test
pnpm --filter @softmaple/binding-lexical typecheck
pnpm --filter @softmaple/binding-lexical lint
```

Lexical and React are peer dependencies; the host app supplies them.

## Related

- [`@softmaple/block-model`](../block-model/README.md) — the model this binds to
- [`docs/design/surface-bindings.md`](../../docs/design/surface-bindings.md) — the binding contract
- [`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md) — layer boundaries
