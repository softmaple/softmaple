import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoomIdentity,
  createRoomPresenceAdapter,
  useRoomPresence,
} from "./presence";

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  postMessage(): void {}

  close(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("room presence", () => {
  it("derives a stable label and palette color from a tab id", () => {
    expect(createRoomIdentity("a-fixed-1234")).toEqual({
      userId: "a-fixed-1234",
      name: "Peer 1234",
      color: expect.stringMatching(/^#[0-9A-F]{6}$/),
    });
    expect(createRoomIdentity("a-fixed-1234")).toEqual(
      createRoomIdentity("a-fixed-1234"),
    );
  });

  it("uses an isolated presence channel for each room", async () => {
    const identity = createRoomIdentity("peer-a");
    const first = createRoomPresenceAdapter("room-a", identity);
    const second = createRoomPresenceAdapter("room-b", identity);

    try {
      expect(first).not.toBe(second);
      expect(first.getConnectionState()).toBe("disconnected");
      expect(second.getConnectionState()).toBe("disconnected");
    } finally {
      await Promise.all([first.disconnect(), second.disconnect()]);
    }
  });

  it("does not expose users from the previous room during a room switch", async () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const renders: Array<{
      readonly roomId: string;
      readonly userCount: number;
    }> = [];
    const { result, rerender } = renderHook(
      ({ roomId }) => {
        const presence = useRoomPresence(roomId);
        renders.push({ roomId, userCount: presence.users.length });
        return presence;
      },
      { initialProps: { roomId: "room-a" } },
    );
    await waitFor(() =>
      expect(result.current.connectionState).toBe("connected"),
    );
    act(() => result.current.updateSelection(null));
    await waitFor(() => expect(result.current.users).toHaveLength(1));
    renders.length = 0;

    rerender({ roomId: "room-b" });

    expect(renders[0]).toEqual({ roomId: "room-b", userCount: 0 });
  });
});
