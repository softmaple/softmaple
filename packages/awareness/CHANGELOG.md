# Changelog

All notable changes to `@softmaple/awareness` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`createNoopAdapter`** — SSR-safe and test-safe no-op `PresenceAdapter`
  implementation. Maintains the full connection state machine and subscriber
  contracts but never touches the network. Exported from
  `@softmaple/awareness/adapters` and as a dedicated subpath
  `@softmaple/awareness/adapters/noop`.
- **`useUpdateSelection` throttle** — drag-select interactions now collapse
  high-frequency updates into a single trailing-edge send per window (default
  50 ms, configurable via the first argument). Mirrors the existing
  `useUpdateCursor` behavior described in design §7.
- **WebSocket runtime payload validation** — every inbound `presence_update`,
  `join`, `leave`, `presence_sync`, and `error` frame is validated against a
  runtime type guard before being applied to local state. Malformed frames
  are dropped and reported via `adapter.onError`.
- **Clear-cursor wire semantics** — the WebSocket adapter now normalizes
  `cursor: undefined` / `selection: undefined` to `null` on send and back to
  `undefined` on receive so that "clear cursor" updates survive JSON
  serialization across peers. See README §"WebSocket server contract".
- **`PresenceProvider.maxRecentActivity` prop** — configurable cap on the
  bounded recent-activity buffer (default 50). Older events evict FIFO.
- **IDLE activity events** — when the local status sweep demotes a user from
  `active` to `idle`, an `ACTIVITY_TYPE.IDLE` event is appended to
  `recentActivity` so consumers can render "X went idle" indicators.
- **`@softmaple/awareness/adapters/noop` subpath export** — granular import
  surface for tree-shaking the noop adapter into SSR bundles without pulling
  in BroadcastChannel/WebSocket implementations.

### Changed

- `useUpdateCursor` and `useUpdateSelection` both accept `null` as an alias
  for `undefined` ("clear cursor / selection") at the hook boundary. The
  hook normalizes to `undefined` before calling the adapter.
- Trailing-edge throttle logic shared between `useUpdateCursor` and
  `useUpdateSelection` is now centralized in an internal
  `useTrailingEdgeThrottle` hook.

### Fixed

- Local status sweep no longer re-emits the same `idle` transition on
  consecutive ticks. The internal `presenceRef` is now updated in lockstep
  with the sweep result so subsequent ticks see post-sweep statuses
  immediately, before React commits the `setPresence` state update.
