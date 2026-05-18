export interface EditorSelection<TPosition> {
  anchor: TPosition;
  focus: TPosition;
}

// Opaque marker for editor operations to avoid over-specifying before the concrete Event Graph implementation
export type EditorOperation = unknown;

export type AdapterSubscription = () => void;

export interface CollaborationAdapter<
  TPosition,
  TSelection = EditorSelection<TPosition>,
  TOperation = EditorOperation,
> {
  getDocumentSnapshot(): unknown;

  applyLocalOperation(operation: TOperation): void;
  applyRemoteOperations(operations: TOperation[]): void;

  getSelection(): TSelection | null;
  restoreSelection(selection: TSelection | null): void;

  // Optional: allows the adapter to adjust the given selection against a set of concurrent remote operations
  mapSelectionThroughOperations?(
    selection: TSelection,
    operations: TOperation[],
  ): TSelection;

  observeLocalOperations(
    callback: (operations: TOperation[]) => void,
  ): AdapterSubscription;

  destroy(): void;

  capabilities?: {
    supportsSelectionMapping?: boolean;
    supportsBlockLevelAwareness?: boolean;
  };
}
