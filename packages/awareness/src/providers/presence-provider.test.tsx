import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AdapterConnectionState,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceAdapter,
  PresenceCallback,
  Unsubscribe,
} from "../adapters/types";
import { PRESENCE_EVENT } from "../constants/presence-events";
import type { PresenceUser } from "../types/presence";
import type { PresenceContextValue } from "./presence-context";
import { PresenceContext } from "./presence-context";
import { PresenceProvider } from "./presence-provider";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

class MockPresenceAdapter implements PresenceAdapter {
  private readonly eventCallbacks = new Set<EventCallback>();

  connect = vi.fn(async (): Promise<void> => {});

  disconnect = vi.fn(async (): Promise<void> => {});

  getConnectionState = (): AdapterConnectionState => "connected";

  updatePresence = vi.fn();

  broadcast = vi.fn();

  onPresenceChange = (callback: PresenceCallback): Unsubscribe => {
    callback(new Map());
    return (): void => {};
  };

  onEvent = (callback: EventCallback): Unsubscribe => {
    this.eventCallbacks.add(callback);
    return (): void => {
      this.eventCallbacks.delete(callback);
    };
  };

  onConnectionChange = (callback: ConnectionCallback): Unsubscribe => {
    callback("connected");
    return (): void => {};
  };

  onError =
    (_callback: ErrorCallback): Unsubscribe =>
    (): void => {};

  getPresence = (): ReadonlyMap<string, PresenceUser> => new Map();

  getSelf = (): null => null;

  emitTyping = (isTyping: boolean): void => {
    for (const callback of this.eventCallbacks) {
      callback({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          userId: "remote-user",
          updates: { meta: { isTyping } },
        },
        timestamp: 123,
      });
    }
  };
}

describe("PresenceProvider", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not record stop-typing updates as typing activity", async () => {
    const adapter = new MockPresenceAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter}>
          <PresenceContext.Consumer>
            {(value) => {
              contextRef.current = value;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    act(() => {
      adapter.emitTyping(false);
    });

    expect(contextRef.current?.recentActivity).toEqual([]);

    act(() => {
      adapter.emitTyping(true);
    });

    expect(contextRef.current?.recentActivity).toHaveLength(1);
    expect(contextRef.current?.recentActivity[0]?.data).toEqual({
      type: "typing",
      isTyping: true,
    });

    await act(async () => {
      root.unmount();
    });
  });
});
