import type { PresenceUser } from "@softmaple/awareness";
import type {
  LexicalBinding,
  LogicalSelection,
} from "@softmaple/binding-lexical";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteSelectionLayer,
  resolvePeerSelection,
} from "./RemoteSelectionLayer";

class MockResizeObserver {
  observe(): void {}

  disconnect(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const peer: PresenceUser = {
  connectionId: "conn-peer-b",
  userId: "peer-b",
  name: "Peer B",
  color: "#475BD8",
  status: "active",
  lastActivityAt: 1,
  lastSeenAt: 1,
  clock: 0,
  selection: {
    anchor: {
      blockId: "block-a",
      anchor: { type: "boundary", edge: "start", affinity: "after" },
    },
    focus: {
      blockId: "block-a",
      anchor: { type: "boundary", edge: "end", affinity: "before" },
    },
  },
};

describe("remote selection resolution", () => {
  it("skips unresolved peers and can resolve them after history arrives", () => {
    const logical: LogicalSelection = {
      anchor: { blockId: "block-a", offset: 0 },
      focus: { blockId: "block-a", offset: 4 },
    };
    let historyAvailable = false;
    const resolveSelection = vi.fn(() => {
      if (!historyAvailable) throw new Error("Unknown selection anchor");
      return logical;
    });

    expect(resolvePeerSelection({ resolveSelection }, peer)).toBeNull();
    historyAvailable = true;
    expect(resolvePeerSelection({ resolveSelection }, peer)).toEqual(logical);
    expect(resolveSelection).toHaveBeenCalledTimes(2);
  });

  it("retries unresolved anchors when replica history changes", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let retry: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const resolveSelection = vi.fn(() => {
      throw new Error("Unknown selection anchor");
    });
    const binding = {
      replica: {
        subscribe: (listener: () => void) => {
          retry = listener;
          return unsubscribe;
        },
      },
      resolveSelection,
      getBlockIndex: () => ({
        blockIdToNodeKey: new Map(),
        nodeKeyToBlockId: new Map(),
        numberedListOverrides: new Map(),
      }),
    } as unknown as LexicalBinding;
    const host = document.createElement("div");
    document.body.append(host);
    const rendered = render(
      createElement(RemoteSelectionLayer, {
        binding,
        hostRef: { current: host },
        selfId: "peer-a",
        users: [peer],
      }),
    );
    expect(resolveSelection).toHaveBeenCalledTimes(1);

    act(() => retry?.());

    expect(resolveSelection).toHaveBeenCalledTimes(2);
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    host.remove();
  });
});
