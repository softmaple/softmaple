// @vitest-environment jsdom

import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@softmaple/collab-protocol";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLAB_CLIENT_CLOSE_CODE } from "./collab-client-close";
import { useCollabDocument } from "./use-collab-document";

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: null,
      }),
    },
  }),
}));

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

type FakeWebSocketEventType = "open" | "message" | "close" | "error";
type FakeWebSocketListener = (event: Event | MessageEvent<string>) => void;

/** Mirrors Chromium's WebSocket.close() close-code validation. */
const assertBrowserWebSocketCloseCode = (code: number | undefined): void => {
  if (code === undefined) return;
  if (code === 1000 || (code >= 3000 && code <= 4999)) return;
  throw new DOMException(
    `Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
    "InvalidAccessError",
  );
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  private readonly listeners = new Map<
    FakeWebSocketEventType,
    Set<FakeWebSocketListener>
  >();

  constructor(url: string) {
    this.url = url;
    fakeSockets.push(this);
  }

  addEventListener = (
    type: FakeWebSocketEventType,
    listener: FakeWebSocketListener,
  ): void => {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  };

  removeEventListener = (
    type: FakeWebSocketEventType,
    listener: FakeWebSocketListener,
  ): void => {
    this.listeners.get(type)?.delete(listener);
  };

  send = (): void => {};

  close = (code?: number, reason?: string): void => {
    assertBrowserWebSocketCloseCode(code);
    this.closeCalls.push({ code, reason });
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", new CloseEvent("close", { code: code ?? 1000, reason }));
  };

  emitOpen = (): void => {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", new Event("open"));
  };

  emitMessage = (data: unknown): void => {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  };

  emitRawMessage = (data: string): void => {
    this.emit("message", new MessageEvent("message", { data }));
  };

  private emit = (
    type: FakeWebSocketEventType,
    event: Event | MessageEvent<string>,
  ): void => {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  };
}

const fakeSockets: FakeWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

type HookState = ReturnType<typeof useCollabDocument>;

const renderCollabHook = (
  documentId: string,
  sessionMode: "authenticated" | "public" = "public",
): { result: { current: HookState }; unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const result: { current: HookState } = {
    current: {
      replica: null,
      status: "connecting",
      canWrite: false,
      error: null,
      onBindingChange: () => {},
    },
  };

  const Capture = (): null => {
    result.current = useCollabDocument(documentId, sessionMode);
    return null;
  };

  act(() => {
    root.render(createElement(Capture));
  });

  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const waitForSocket = async (): Promise<FakeWebSocket> => {
  await act(async () => {
    await Promise.resolve();
  });
  const socket = fakeSockets.at(-1);
  if (socket === undefined) {
    throw new Error("Expected a collaboration WebSocket to be created");
  }
  return socket;
};

describe("useCollabDocument", () => {
  beforeEach(() => {
    fakeSockets.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllTimers();
  });

  it("should close invalid server payloads with an application close code", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-invalid");
    const socket = await waitForSocket();

    // Act
    act(() => {
      socket.emitOpen();
      socket.emitRawMessage("not-json");
    });

    // Assert
    expect(socket.closeCalls).toEqual([
      {
        code: COLLAB_CLIENT_CLOSE_CODE.InvalidServerResponse,
        reason: "Invalid collaboration response",
      },
    ]);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe(
      "The collaboration server returned invalid data",
    );
    expect(result.current.canWrite).toBe(false);

    // Fatal: must not schedule reconnect
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fakeSockets).toHaveLength(1);

    unmount();
  });

  it("should close retryable server errors without marking the session fatal", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-retry");
    const socket = await waitForSocket();

    // Act
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.PersistenceFailed,
        message: "Temporary persistence failure",
        retryable: true,
      });
    });

    // Assert
    expect(socket.closeCalls).toEqual([
      {
        code: COLLAB_CLIENT_CLOSE_CODE.RetryableServerError,
        reason: "Retry collaboration sync",
      },
    ]);
    expect(result.current.error?.message).toBe("Temporary persistence failure");
    expect(result.current.status).toBe("offline");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(fakeSockets.length).toBeGreaterThan(1);

    unmount();
  });

  it("should close fatal server errors and skip reconnect", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-fatal");
    const socket = await waitForSocket();

    // Act
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.Forbidden,
        message: "Access denied",
        retryable: false,
      });
    });

    // Assert
    expect(socket.closeCalls).toEqual([
      {
        code: COLLAB_CLIENT_CLOSE_CODE.FatalServerError,
        reason: "Fatal error",
      },
    ]);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("Access denied");
    expect(result.current.canWrite).toBe(false);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fakeSockets).toHaveLength(1);

    unmount();
  });

  it("should keep the apply-failure error observable when closing the socket", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-apply", "public");
    const socket = await waitForSocket();

    // Act — Ready with the wrong access mode throws inside the handler
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        documentId: "doc-apply",
        userId: "user-1",
        role: "EDITOR",
        canWrite: true,
      });
    });

    // Assert
    expect(socket.closeCalls).toEqual([
      {
        code: COLLAB_CLIENT_CLOSE_CODE.ResponseApplyFailure,
        reason: "Collaboration response could not be applied",
      },
    ]);
    expect(result.current.error?.message).toBe(
      "The collaboration access mode is invalid",
    );

    unmount();
  });

  it("should never call browser WebSocket.close with forbidden protocol codes", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-codes");
    const socket = await waitForSocket();

    // Act — exercise every client-initiated coded close path
    act(() => {
      socket.emitOpen();
      socket.emitRawMessage("{");
    });

    const { unmount: unmountRetry } = renderCollabHook("doc-codes-retry");
    const retrySocket = await waitForSocket();
    act(() => {
      retrySocket.emitOpen();
      retrySocket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.Conflict,
        message: "retry me",
        retryable: true,
      });
    });

    const { unmount: unmountFatal } = renderCollabHook("doc-codes-fatal");
    const fatalSocket = await waitForSocket();
    act(() => {
      fatalSocket.emitOpen();
      fatalSocket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.AuthenticationFailed,
        message: "auth failed",
        retryable: false,
      });
    });

    const { unmount: unmountApply } = renderCollabHook("doc-codes-apply");
    const applySocket = await waitForSocket();
    act(() => {
      applySocket.emitOpen();
      applySocket.emitMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        documentId: "doc-codes-apply",
        userId: null,
        role: null,
        canWrite: false,
      });
    });

    // Assert — FakeWebSocket.close would have thrown for 1001–2999
    const codedCloses = [
      ...socket.closeCalls,
      ...retrySocket.closeCalls,
      ...fatalSocket.closeCalls,
      ...applySocket.closeCalls,
    ].filter((call) => call.code !== undefined);

    expect(codedCloses.length).toBeGreaterThanOrEqual(4);
    for (const call of codedCloses) {
      expect(
        call.code === 1000 ||
          (call.code !== undefined && call.code >= 3000 && call.code <= 4999),
      ).toBe(true);
      expect(call.code).not.toBe(1008);
      expect(call.code).not.toBe(1011);
    }

    unmount();
    unmountRetry();
    unmountFatal();
    unmountApply();
  });
});
