# Awareness & Presence Design

## 1. Overview

This document describes the design of **awareness and presence** in a
real-time collaborative experience. In Softmaple, the package name is
`@softmaple/awareness`; there is no `@softmaple/presence` package.

Presence remains the right term for user-facing concepts like who is
online, live cursors, selection highlights, and existing API names such
as `PresenceUser` or `PresenceBar`.

Awareness and presence answer four fundamental user questions with
minimal cognitive load:

1. **Who** is currently in the room?
2. **Where** are they in the document?
3. **What** are they doing (roughly)?
4. **Will it affect me?**

The system is designed to be **low-noise, non-blocking, and progressively disclosed**.

---

## 2. Design Principles

### 2.1 Low Interruption by Default

- Awareness information should be **visible but ignorable**
- No blocking modals, no toast spam
- Strong signals only appear on hover, focus, or potential conflict

### 2.2 Approximation Over Precision

- Presence is **probabilistic**, not authoritative
- "Someone is editing here" is sufficient
- Exact keystrokes or real-time character updates are unnecessary

### 2.3 Layered Awareness

Information is presented in layers from coarse to fine:

| Layer    | Question Answered         |
| -------- | ------------------------- |
| Global   | Who is online?            |
| Document | Who is in this document?  |
| Section  | Who is editing this part? |
| Action   | What just happened?       |

---

## 3. Non-Goals

The following are explicitly out of scope for the first iteration:

- Chat or messaging
- Audio / video presence
- Detailed activity logs
- Real-time keystroke mirroring
- Conflict resolution UI (handled at data layer)

---

## 4. Presence Model

### 4.1 User Presence State

```ts
type PresenceStatus = "active" | "idle" | "offline";

interface PresenceUser {
  userId: string;
  name: string;
  avatarUrl?: string;
  color: string;

  status: PresenceStatus;
  lastActiveAt: number;

  cursor?: {
    blockId?: string;
    offset?: number;
  };

  selection?: {
    blockId: string;
    from: number;
    to: number;
  };

  meta?: {
    isTyping?: boolean;
  };
}
```

### 4.2 Status Rules

| Status    | Definition                                 |
| --------- | ------------------------------------------ |
| `active`  | User performed an action in last N seconds |
| `idle`    | Connected but no recent activity           |
| `offline` | Disconnected or heartbeat expired          |

---

## 5. UI Components

### 5.1 Presence Bar (Global Awareness)

**Purpose**  
Shows who is currently in the room.

The current UI component name is `PresenceBar`. The package that
exports it is `@softmaple/awareness`.

**Behavior**

- Displays up to N avatars
- Overflow shown as `+X`
- Tooltip reveals name and status
- Sorted by recent activity

---

### 5.2 Live Cursor (Local Awareness)

**Purpose**  
Indicates where another user is editing.

**Behavior**

- Colored caret
- Username label appears on movement
- Label fades out after 2-3 seconds
- Cursor movement is interpolated (no jitter)

---

### 5.3 Selection Highlight (Block Awareness)

**Purpose**  
Shows which block or range is being edited by others.

**Behavior**

- Semi-transparent background highlight
- Same color as user
- Optional border
- Hover reveals user badge

---

### 5.4 Activity Indicator (Action Awareness)

**Purpose**  
Communicates recent activity without distraction.

**Examples**

- "Adam is editing this paragraph"
- "2 people editing here"

---

## 6. Interaction Rules

- Cursor labels fade after 3 seconds
- Typing indicators timeout after inactivity
- Hover reveals details
- No persistent animation

---

## 7. Performance Considerations

- Cursor updates throttled (50-100ms)
- Off-screen cursors not rendered
- Presence is eventually consistent

---

## 8. Accessibility

- Non-blocking indicators
- Screen reader friendly
- Color is never the sole signal

---

## 9. Progressive Rollout Plan

### Phase 1

- Presence bar
- Online count

### Phase 2

- Live cursors
- Selection highlights

### Phase 3

- Minimap / scrollbar indicators

---

## 10. Success Criteria

- Users feel confident editing together
- Rare confusion about collaborators
- Minimal performance impact

---

## 11. Architecture Boundary

Awareness/presence state is ephemeral session state. It must not own
persistent document merge logic and must remain independent from
`@softmaple/eg-walker`.

Related docs:

- [Architecture Overview](./architecture-overview.md)
- [Package Responsibilities](./package-responsibilities.md)
- [ADR: Collaboration Architecture Boundaries](./adr/collaboration-architecture-boundaries.md)

## 12. Summary

Awareness and presence should create **calm confidence**, not
excitement.

> "I know who's here, and I'm not surprised by their actions."
