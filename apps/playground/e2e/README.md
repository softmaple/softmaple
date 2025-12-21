# Playwright E2E Tests for Playground

## Overview
This directory contains end-to-end tests for the SoftMaple playground application using Playwright.

## Test Status

### ✅ Passing Tests (5/19)
- Two-Panel Text Editor: maintain independent state, support multi-line text, have accessible labels
- Collaborative Editor: display CRDT algorithm info, have accessible labels

### ❌ Failing Tests (14/19)

#### Home Page Tests (4 failures)
- All home page tests timeout on initial load or navigation
- **Root Cause**: Pages timeout waiting for networkidle state. Possible TanStack Start SSR hydration delay.
- **Fix Required**: Investigate TanStack Start dev server config and hydration timing

#### Collaborative Editor Sync Tests (7 failures)
- All CRDT synchronization tests fail - replica 2 remains empty when typing in replica 1
- **Root Cause**: The `useEffect` async processing pattern doesn't work reliably in E2E tests
  - Playwright's `fill()` method might not trigger React onChange events correctly
  - React state batching causes stale closures in async `useEffect`
  - Event processing queue (`pendingEvents`) triggers `useEffect` but state updates might be missed
- **Fix Required**:
  1. Refactor collaborative editor to use synchronous state updates instead of async queuing
  2. OR: Use Playwright's `type()` method with proper delays instead of `fill()`
  3. OR: Add data-testid attributes and poll for actual DOM updates

#### Two-Panel Editor Tests (3 failures)
- Editor A and Editor B tests timeout waiting for fill() to complete
- **Root Cause**: Same as home page - page load/hydration timing issues
- **Fix Required**: Investigate TanStack Start component mounting delays

## Running Tests

```bash
# Run all E2E tests
pnpm --filter @softmaple/playground test:e2e

# Run with UI (debug mode)
pnpm --filter @softmaple/playground test:e2e:ui

# Run single test file
pnpm --filter @softmaple/playground test:e2e e2e/home.spec.ts
```

## Configuration
- Browser: Chromium (headless)
- Base URL: http://localhost:3000
- Timeout: 60000ms per test, 10000ms for expect assertions
- Dev server auto-starts before tests

## Known Issues

### Issue 1: TanStack Start Hydration Delays
**Impact**: Home page and navigation tests timeout
**Workaround**: Use longer timeouts or poll for specific elements
**Permanent Fix**: Review TanStack Start SSR/hydration config

### Issue 2: CRDT Sync Not Working in E2E Tests
**Impact**: All collaborative editor synchronization tests fail
**Workaround**: Use `page.type()` with delays instead of `fill()`, or add explicit waits for state updates
**Permanent Fix**: Refactor collaborative editor to use synchronous updates or add test-specific synchronization primitives

### Issue 3: Playwright fill() vs React onChange
**Impact**: Textarea fills don't trigger expected behavior
**Technical Details**:
- Playwright's `fill()` sets input.value directly and dispatches input/change events
- React's synthetic events might not fire correctly for programmatic value changes
- The collaborative editor's change handlers depend on accurate diff detection between old/new state

## Next Steps

1. **Fix TanStack Start hydration** - Investigate why pages take so long to become interactive
2. **Refactor collaborative editor** - Make CRDT event processing synchronous or add proper async coordination
3. **Add retry logic** - Use Playwright's auto-retry for flaky tests
4. **Add debug logging** - Expose CRDT state in data attributes for E2E verification
5. **Create fixture for CRDT testing** - Pre-initialize replicas with known state for more reliable tests
