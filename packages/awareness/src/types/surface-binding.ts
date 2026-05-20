export interface SurfaceSelection<TPosition> {
  anchor: TPosition;
  focus: TPosition;
}

// Opaque marker for surface operations to avoid over-specifying before
// the concrete Event Graph implementation.
export type SurfaceOperation = unknown;

export type SurfaceBindingSubscription = () => void;

export interface SurfaceBinding<
  TPosition,
  TSelection = SurfaceSelection<TPosition>,
  TOperation = SurfaceOperation,
> {
  getDocumentSnapshot(): unknown;

  applyLocalOperation(operation: TOperation): void;
  applyRemoteOperations(operations: readonly TOperation[]): void;

  getSelection(): TSelection | null;
  restoreSelection(selection: TSelection | null): void;

  // Optional: allows the binding to adjust the given selection against
  // a set of concurrent remote operations.
  mapSelectionThroughOperations?(
    selection: TSelection,
    operations: readonly TOperation[],
  ): TSelection;

  observeLocalOperations(
    callback: (operations: readonly TOperation[]) => void,
  ): SurfaceBindingSubscription;

  destroy(): void;

  capabilities?: {
    supportsSelectionMapping?: boolean;
    supportsBlockLevelAwareness?: boolean;
  };
}
