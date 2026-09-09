# Softmaple token and component map

The signature is a calm document surface with identifiable people at its edge,
and a narrow yellow seam when two people intentionally share context. Yellow
marks actions and attention. Text links and collaborator identity use other hues.

| Role | Light | Dark | Usage |
| --- | --- | --- | --- |
| Workspace | `#F4F3EE` | `#111315` | Outer canvas |
| Document / surface | `#FFFEFA` | `#191C1F` | Writing and reading |
| Raised | `#FFFFFF` | `#23272B` | Controls and disclosures |
| Text | `#191C20` | `#F3F4EF` | Primary reading |
| Secondary text | `#565B60` | `#B0B6BC` | Metadata |
| Divider | `#DADDD8` | `#373D43` | Structure |
| Input boundary | `#81877F` | `#7B848C` | Interactive boundaries |
| Action | `#FFD523` | `#FFD94A` | Dark text on yellow |
| Readable emphasis / focus | `#766000` / `#756000` | `#FFE16B` | Small labels and focus |
| Attention surface | `#FFF4BF` | `#332D15` | Explicit shared attention |
| Link | `#175BB5` | `#83B5FF` | Navigation in prose |
| Success | `#226644` | `#7ED5A5` | Durable feedback |
| Warning | `#825200` | `#F4BE65` | Recovery |
| Destructive | `#AF2942` | `#FF93A2` | Errors and destructive actions |

People use paired blue, teal, plum, coral and violet hues with a deterministic
account mapping. Yellow is excluded. Names, roster grouping and session counts
carry identity alongside color.

DM Sans is retained for interface and prose, Syne for sparse brand/display type,
and JetBrains Mono for code and compact counters. No new font dependency.
Spacing follows 4 px increments. Controls use 8 px radii, panels 12 px. The desktop
rail is 64 px, optional navigator 256 px, and main header 56 px. Prose targets
approximately 720 px. Navigation collapses before the writer loses useful width;
compact interactive targets are at least 44 px where the redesigned rules apply.

## Shared foundations

- `packages/ui/src/styles/globals.css`: semantic utility registration in the shared
  Tailwind compilation entry point, with legacy fallbacks.
- `app/design.css`: semantic roles, theme pairs, spacing, shell, document measure,
  attention pane container queries, focus, reduced motion and forced colors.
- `app/legacy-design.css`: retained rollback palette and original shared styles.
- `RedesignProvider`: server-evaluated flags without editor remount keys.
- Collaboration preferences: local focus mode, precise-location sharing and
  reduced motion; system theme and system reduced motion remain respected.
- Workspace desktop rail, optional navigator and existing mobile Sheet: one
  destination structure with visible search and accessible labels.
- `DocHeader`: durable save status independently of live connectivity, recovery
  actions, public-link state and workspace-access explanation.
- Existing awareness roster, avatar, cursor, selection and layer primitives are
  extended/integrated; `AttentionInvitation` is a new reusable tested primitive.
- `SharedAttention`, `SharedDocumentProjection`, `DocumentOutline`, stable anchor
  helpers, bounded relevance selection and local remembered places compose the
  editing experience without owning a second document transport.
- Field/List and document search share paginated title retrieval. Pinning and
  recent choices are local per account/workspace and never reshuffle on edits.
- BrandMark, RouteLoading, RouteError and global not-found apply the identity to
  public, authentication, loading and recovery routes.

Motion durations are 100 ms for controls, 200 ms for panels, 240 ms for attention.
Reduced motion removes nonessential transitions. Focus remains visible in both
themes and forced-colors mode. New UI has no decorative arrival animation, sound,
productivity scoring or cursor trails.
