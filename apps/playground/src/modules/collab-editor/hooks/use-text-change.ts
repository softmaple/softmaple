import { useCallback, useEffect } from "react";
import type { RoomManager } from "../room-manager";
import { performTextOperation } from "./text-change-helpers";

/**
 * Hook for handling text changes in the collaborative editor
 */
export function useTextChange(
  roomManager: RoomManager | null,
  onTextUpdate?: (text: string) => void,
) {
  // Handle text changes immediately for responsive UI
  const handleTextChange = useCallback(
    async (value: string, source: "local" | "remote" = "local") => {
      try {
        if (!roomManager || source === "remote") return;

        const currentText = roomManager.getText();

        if (value === currentText) return; // No change

        // Perform the appropriate text operation
        await performTextOperation(roomManager, currentText, value);
      } catch (error) {
        console.error("Failed to handle text change:", error);
        // Attempt to reconcile by fetching latest text
        if (roomManager && onTextUpdate) {
          onTextUpdate(roomManager.getText());
        }
      }
    },
    [roomManager, onTextUpdate],
  );

  // Subscribe to remote text changes
  useEffect(() => {
    if (!roomManager || !onTextUpdate) return;

    // Register a listener for content changes
    const unsubscribe = roomManager.addContentChangeListener(() => {
      onTextUpdate(roomManager.getText());
    });

    // Clean up the listener when the effect is destroyed
    return unsubscribe;
  }, [roomManager, onTextUpdate]);

  return { handleTextChange };
}
