## Layering Rules (Source of Truth)

The cross-package boundaries for `@softmaple/awareness`,
`@softmaple/eg-walker`, and `apps/*` are defined in
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
That document is the source of truth and is enforced mechanically by
the `style/noRestrictedImports` rule in `biome.jsonc` in this package.

In short, this package MUST NOT depend on `@softmaple/eg-walker` or on
any editor framework (`lexical`, `prosemirror-*`, `slate` / `slate-*`),
including subpath imports. Editor bindings are deferred (issue B2)
and will live in a dedicated `bindings/<editor>` sub-path when
introduced. Read the layering doc before adding new dependencies or
sub-path exports.

If you change the deny list, update both `biome.jsonc` here **and**
the matching ESLint patterns in
`packages/eslint-config/collaboration-layers.js` so eg-walker stays
in sync.

---

When working on UI components, always use the `softmaple-awareness-storybook-mcp` MCP tools to access Storybook's component and documentation knowledge before answering or taking any action.

- **CRITICAL: Never hallucinate component properties!** Before using ANY property on a component from a design system (including common-sounding ones like `shadow`, etc.), you MUST use the MCP tools to check if the property is actually documented for that component.
- Query `list-all-documentation` to get a list of all components
- Query `get-documentation` for that component to see all available properties and examples
- Only use properties that are explicitly documented or shown in example stories
- If a property isn't documented, do not assume properties based on naming conventions or common patterns from other libraries. Check back with the user in these cases.
- Use the `get-storybook-story-instructions` tool to fetch the latest instructions for creating or updating stories. This will ensure you follow current conventions and recommendations.
- Check your work by running `run-story-tests`.

Remember: A story name might not reflect the property name correctly, so always verify properties through documentation or example stories before using them.
