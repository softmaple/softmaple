# Editor-Agnostic Collaboration Adapter Contract

## Purpose

Softmaple is evolving into an editor-agnostic collaboration toolkit. The goal of the Editor Adapter Contract is to bridge concrete editors (like textareas, Lexical, CodeMirror, etc.) to Softmaple's core collaboration primitives without coupling the core logic to any specific editor UI or state.

Specifically, this contract aims to:
- Bridge concrete editors to Softmaple collaboration primitives.
- Normalize document access, local changes, remote operations, selection read/restore, and selection mapping.
- Keep `@softmaple/eg-walker` completely free of UI/editor concerns.
- Keep `@softmaple/awareness` editor-agnostic, enabling it to render presence and selections universally.

## Core Abstractions

The adapter normalizes the API between the editor and the collaboration engine, defining interactions through generic positions, selections, and operations.

### TypeScript Interfaces

```typescript
interface EditorSelection<TPosition> {
  anchor: TPosition;
  focus: TPosition;
}

interface EditorOperation {
  /* Opaque type for future expansion */
}

type AdapterSubscription = () => void; // dispose function

interface CollaborationAdapter<TPosition, TSelection = EditorSelection<TPosition>, TOperation = EditorOperation> {
  // Document state
  getDocumentSnapshot(): unknown;
  
  // Operations
  applyLocalOperation(operation: TOperation): void;
  applyRemoteOperations(operations: TOperation[]): void;
  observeLocalOperations(callback: (operations: TOperation[]) => void): AdapterSubscription;
  
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
- **`applyRemoteOperations()`**: Accepts incoming operations from peers and applies them to the local editor state.
- **`getSelection()`**: Reads the current local selection, returning an editor-independent position model.
- **`restoreSelection()`**: Restores a previously saved selection back into the editor.
- **`mapSelectionThroughOperations()`**: (Optional) Adjusts a selection position when remote operations shift the content around.
- **`observeLocalOperations()`**: Hooks into the editor's change events to capture user intent and translate it into a standard `EditorOperation`.
- **`destroy()`**: Cleans up subscriptions and references when the editor unmounts.

## Guidance for Editor Families

### Textarea / Plain Text
Textareas operate on simple 1D strings and integer offsets. Adapters for textareas generally map the 1D offset into the core engine's coordinate system. Text-level diffing might be necessary since the textarea doesn't natively yield delta operations.

### CodeMirror / Monaco
These code editors are highly optimized for large documents and provide explicit "transaction" or "edit" objects. The adapter translates native editor transactions into `EditorOperation` and vice versa, often leveraging native position mapping utilities provided by the editor.

### Lexical / ProseMirror / Slate
Rich text and block editors. Positions usually include paths (node hierarchies) and offsets. These adapters require deeper integration to synchronize nested structures. They map block CRDT updates directly into editor node updates.

### Block Editors
Focus on block-level consistency. The position model might only care about block IDs and local offsets within blocks. The adapter's primary role is resolving block ordering and nested block operations.

### Canvas / Whiteboard Tools
Spatial editors where positions are `(x, y)` coordinates, widths, and heights. Selections are bounding boxes instead of anchor/focus text offsets. The adapter for canvas applications synchronizes object properties and z-indexes rather than text characters.

## Anti-Goals (What NOT to include)

The adapter should remain a thin translation layer. It **MUST NOT** include:
- **CRDT internals**: The adapter applies operations; it does not resolve conflicts or manage tombstones.
- **Event graph persistence**: Loading/saving the document to a database belongs in a separate persistence layer.
- **Network transport**: WebSocket/WebRTC communication is handled outside the adapter.
- **User identity**: It does not care who is typing, only what was typed.
- **Visual cursor rendering**: Rendering a remote peer's cursor is handled by the awareness layer, not the editor adapter.
- **Editor-specific UI components**: The adapter is logical, not visual. No React components or CSS should be defined in the adapter.

## Reference Example: Textarea Adapter

```typescript
// Example: A conceptual implementation of a plain text textarea adapter

export function createTextareaAdapter(
  element: HTMLTextAreaElement
): CollaborationAdapter<number> {
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
