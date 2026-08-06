---
name: git-workflow
description: Softmaple Git branching, commits, pre-commit hooks, and pull requests. Use when creating branches, committing, pushing, opening or updating PRs, fixing pre-commit hook failures, returning to the next branch, or when the user mentions git workflow, --no-verify, branch naming, or commit messages.
license: Complete terms in LICENSE.txt
---

# Git Workflow

Softmaple Git conventions. Default branch is `next`. Follow the critical rules exactly (low freedom).

## Critical rules

1. **Never commit directly to `next`.** Create a feature branch first.
2. **Never use `--no-verify`.** Fix hook failures; do not bypass them.
3. **Always request user approval before commits/pushes.**

## When to use which path

```text
Git task?
├─ Starting work on next? → Branch workflow
├─ Committing changes? → Commit workflow
├─ Pre-commit hooks failed? → Hook failure loop
├─ Opening/updating a PR? → Pull requests
└─ Switching back to next? → Return to next
```

## Branch workflow

Copy and track:

```text
Branch Progress:
- [ ] Check current branch
- [ ] Create feature branch if on next or detached HEAD
- [ ] Make changes on the feature branch only
```

1. `git branch --show-current`
2. If the result is empty (detached HEAD) or `next`: create a feature branch
   with `git checkout -b type/description-$(date +%s)` before any edits.
   Do not edit while detached or on `next`.
3. Work only on that feature branch

**Branch name format:** `type/description-$(date +%s)`

Examples:

```bash
feature/add-user-auth-1737154800
fix/duplicate-event-handling-1737154800
refactor/cleanup-event-graph-1737154800
docs/update-readme-1737154800
```

Types: `feature`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`, `build`, `perf`, `style`

## Commit workflow

Copy and track:

```text
Commit Progress:
- [ ] Confirm not on next
- [ ] pnpm --filter <package> typecheck (as needed)
- [ ] pnpm --filter <package> test (as needed)
- [ ] pnpm lint / pnpm format (as needed)
- [ ] Request user approval to commit/push
- [ ] Stage and commit (no --no-verify)
- [ ] If hooks fail → Hook failure loop
- [ ] Push after approval
```

### Commit message format

`type(scope): summary`

- **Types:** `fix`, `feat`, `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`
- **Scopes:** `apps/web`, `packages/<name>`, or omit for root

Examples:

```text
feat(packages/eg-walker): add incremental CRDT integration
fix(apps/web): resolve duplicate event crash
docs: update functional programming guidelines
```

### Pre-commit hooks

Hooks run Biome formatting, ESLint, and type checking. They must pass. Never bypass with `--no-verify`.

## Hook failure loop

1. Read the hook error output
2. Fix the issues (start with `pnpm format`, then address lint/type errors)
3. Stage the fixes
4. Retry the commit **without** `--no-verify`
5. Repeat until hooks pass

## Return to next

When leaving a feature branch for `next`:

```bash
git checkout next
git pull
pnpm i
```

Keeps the branch and dependencies in sync with remote.

## Pull requests

Include:

- Summary of the change
- Test commands run (or note if none)
- Screenshots for UI changes

Push the feature branch and open a PR into `next`. Do not merge your own work unless asked.
