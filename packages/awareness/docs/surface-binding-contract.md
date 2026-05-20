# Surface Binding Contract

> **Naming.** This contract was previously called the "Editor Adapter
> Contract". It has been renamed to **Surface Binding Contract** because
> "surface" generalises beyond text editors to canvas / whiteboard tools
> and other collaborative surfaces. See
> [`docs/design/surface-bindings.md`](../../../docs/design/surface-bindings.md)
> for the full rationale.

## Purpose

Softmaple is evolving into an editor-agnostic, model-agnostic
collaboration toolkit. The goal of the Surface Binding Contract is to
bridge concrete surfaces (textareas, Lexical, CodeMirror, canvases,
etc.) to Softmaple's core collaboration primitives without coupling
the core logic to any specific surface UI or state.

Specifically, this contract aims to:
- Bridge concrete surfaces to Softmaple collaboration primitives.
- Normalize document access, local changes, remote operations, selection read/restore, and selection mapping.
- Keep `@softmaple/eg-walker` completely free of UI/surface concerns.
- Keep `@softmaple/awareness` surface-agnostic, enabling it to render presence and selections universally.

## Core Abstractions

The surface binding normalizes the API between the surface and the collaboration engine, defining interactions through generic positions, selections, and operations.

### TypeScript Interfaces

```typescript
interface SurfaceSelection<TPosition> {
  anchor: TPosition;
  focus: TPosition;
}

interface SurfaceOperation {
  /* Opaque type for future expansion */
}

type SurfaceBindingSubscription = () => void; // dispose function

interface SurfaceBinding<TPosition, TSelection = SurfaceSelection<TPosition>, TOperation = SurfaceOperation> {
  // Document state
  getDocumentSnapshot(): unknown;
  
  // Operations
  applyLocalOperation(operation: TOperation): void;
  applyRemoteOperations(operations: TOperation[]): void;
  observeLocalOperations(callback: (operations: TOperation[]) => void): SurfaceBindingSubscription;
  
  // Selection
  getSelection(): TSelection | null;
  restoreSelection(selection: TSelection | null): void;
  mapSelectionThroughOperations?(selection: TSelection, operations: TOperation[]): TSelection;
  
  // Lifecycle
  destroy(): void;

  // Optional Capability Flags
  capabilities?: {
    supportsSelectionMapping?: boolean;
    supportsBlockLevelAwareness?: boolean;
  };
}
```

## Contract Responsibilities

- **`getDocumentSnapshot()`**: Retrieve the full state of the document for initializing late-joiners.
- **`applyLocalOperation()`**: Acknowledges that the local user made a change. Often loops back to the CRDT to apply the operation.
- **`applyRemoteOperations()`**: Accepts incoming operations from peers and applies them to the local surface state.
- **`getSelection()`**: Reads the current local selection, returning a surface-independent position model.
- **`restoreSelection()`**: Restores a previously saved selection back into the surface.
- **`mapSelectionThroughOperations()`**: (Optional) Adjusts a selection position when remote operations shift the content around.
- **`observeLocalOperations()`**: Hooks into the surface's change events to capture user intent and translate it into a standard `SurfaceOperation`.
- **`destroy()`**: Cleans up subscriptions and references when the surface unmounts.

## Guidance for Surface Families

### Textarea / Plain Text
Textareas operate on simple 1D strings and integer offsets. Bindings for textareas generally map the 1D offset into the core engine's coordinate system. Text-level diffing might be necessary since the textarea doesn't natively yield delta operations.

### CodeMirror / Monaco
These code editors are highly optimized for large documents and provide explicit "transaction" or "edit" objects. The binding translates native surface transactions into `SurfaceOperation` and vice versa, often leveraging native position mapping utilities provided by the surface.

### Lexical / ProseMirror / Slate
Rich text and block editors. Positions usually include paths (node hierarchies) and offsets. These bindings require deeper integration to synchronize nested structures. They map block CRDT updates directly into surface node updates.

### Block Editors
Focus on block-level consistency. The position model might only care about block IDs and local offsets within blocks. The binding's primary role is resolving block ordering and nested block operations.

### Canvas / Whiteboard Tools
Spatial surfaces where positions are `(x, y)` coordinates, widths, and heights. Selections are bounding boxes instead of anchor/focus text offsets. The binding for canvas applications synchronizes object properties and z-indexes rather than text characters. Canvas surfaces bind to an **object engine**, not to the sequence engine (`@softmaple/eg-walker`); see [`docs/design/collaboration-models.md`](../../../docs/design/collaboration-models.md).

## Anti-Goals (What NOT to include)

The binding should remain a thin translation layer. It **MUST NOT** include:
- **CRDT internals**: The binding applies operations; it does not resolve conflicts or manage tombstones.
- **Event graph persistence**: Loading/saving the document to a database belongs in a separate persistence layer.
- **Network transport**: WebSocket/WebRTC communication is handled outside the binding.
- **User identity**: It does not care who is typing, only what was typed.
- **Visual cursor rendering**: Rendering a remote peer's cursor is handled by the awareness layer, not the surface binding.
- **Surface-specific UI components**: The binding is logical, not visual. No React components or CSS should be defined in the binding.

## Reference Example: Textarea Binding

```typescript
// Example: A conceptual implementation of a plain text textarea binding

export function createTextareaBinding(
  element: HTMLTextAreaElement
): SurfaceBinding<number> {
  const listeners = new Set<(ops: any[]) => void>();

  const handleInput = (e: Event) => {
    // Diff element.value against previous value to generate an operation
    const mockOp = { type: 'insert', text: element.value };
    listeners.forEach((cb) => cb([mockOp]));
  };

  element.addEventListener('input', handleInput);

  return {
    getDocumentSnapshot: () => element.value,
    
    applyLocalOperation: (op) => { /* already applied to textarea */ },
    
    applyRemoteOperations: (ops) => {
      // 1. apply string modifications to element.value
      // 2. update cursor position if affected
    },

    getSelection: () => {
      if (element.selectionStart === null) return null;
      return {
        anchor: element.selectionStart,
        focus: element.selectionEnd ?? element.selectionStart
      };
    },

    restoreSelection: (selection) => {
      if (!selection) return;
      element.setSelectionRange(selection.anchor, selection.focus);
    },

    observeLocalOperations: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    destroy: () => {
      element.removeEventListener('input', handleInput);
      listeners.clear();
    }
  };
}
```
