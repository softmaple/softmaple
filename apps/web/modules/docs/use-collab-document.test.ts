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
import { COLLAB_RUNTIME } from "./collab-runtime-routing";
import type { CollabTarget } from "./collab-target";
import { useCollabDocument } from "./use-collab-document";

/** Stands in for the target a Server Component resolves for the page. */
const NITRO_TARGET: CollabTarget = {
  documentUrl: "ws://localhost:3000/collab/document",
  presenceUrl: "ws://localhost:3000/collab/presence",
  runtime: COLLAB_RUNTIME.Nitro,
};

type FakeSessionResult = {
  readonly data: {
    readonly session: {
      readonly access_token: string;
      readonly user: { readonly id: string };
    } | null;
  };
  readonly error: null;
};

const signedOutSession = async (): Promise<FakeSessionResult> => ({
  data: { session: null },
  error: null,
});

/** Mutable so a test can hold the session read open mid-connect. */
const authStub = vi.hoisted(() => ({
  getSession: async (): Promise<FakeSessionResult> => ({
    data: { session: null },
    error: null,
  }),
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => authStub.getSession(),
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

  /** Close event that bypasses readyState, mirroring a stray/duplicate close. */
  emitClose = (code = 1006): void => {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", new CloseEvent("close", { code }));
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

/**
 * Fixed jitter draw: reconnect delays become base * 2 ** attempt / 2, so the
 * timeline below is exact (250ms, 500ms, 1s, ...) with no timing tolerance.
 */
const FIXED_JITTER = 0.5;

const setBrowserOnline = (online: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
};

const setPageVisibility = (visibility: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
};

const emitOnline = (): void => {
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
};

const emitVisibilityChange = (visibility: "hidden" | "visible"): void => {
  setPageVisibility(visibility);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** Server hello for a public document session. */
const publicReadyMessage = (documentId: string) => ({
  protocolVersion: COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.Ready,
  accessMode: COLLAB_ACCESS_MODE.Public,
  documentId,
  userId: null,
  role: null,
  canWrite: false,
});

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
      collaborationStatus: "connecting",
      editable: false,
      error: null,
      flush: async () => undefined,
      onBindingChange: () => {},
      replica: null,
      saveStatus: "idle",
      status: "connecting",
      canWrite: false,
    },
  };

  const Capture = (): null => {
    result.current = useCollabDocument(NITRO_TARGET, documentId, sessionMode);
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
    vi.spyOn(Math, "random").mockReturnValue(FIXED_JITTER);
    authStub.getSession = signedOutSession;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, "onLine");
    Reflect.deleteProperty(document, "visibilityState");
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

  it("should back off exponentially with jitter and keep the same endpoint", async () => {
    // Arrange — a fixed jitter draw halves each attempt's backoff window.
    const { unmount } = renderCollabHook("doc-backoff");
    const first = await waitForSocket();

    // Act / Assert — attempt 0 draws from a 500ms window: 250ms here.
    act(() => {
      first.emitClose();
    });
    advance(249);
    expect(fakeSockets).toHaveLength(1);
    advance(1);
    expect(fakeSockets).toHaveLength(2);

    // attempt 1 doubles the window to 1s: 500ms here.
    act(() => {
      fakeSockets[1]?.emitClose();
    });
    advance(499);
    expect(fakeSockets).toHaveLength(2);
    advance(1);
    expect(fakeSockets).toHaveLength(3);

    // attempt 2 doubles it again to 2s: 1s here.
    act(() => {
      fakeSockets[2]?.emitClose();
    });
    advance(999);
    expect(fakeSockets).toHaveLength(3);
    advance(1);
    expect(fakeSockets).toHaveLength(4);

    // Reconnects stay on the runtime the server selected for the document.
    for (const socket of fakeSockets) {
      expect(socket.url).toBe(NITRO_TARGET.documentUrl);
    }

    unmount();
  });

  it("should reset the backoff after a connection is established", async () => {
    // Arrange — two failures first, so the window has already grown.
    const { result, unmount } = renderCollabHook("doc-reset");
    const first = await waitForSocket();
    act(() => {
      first.emitClose();
    });
    advance(250);
    act(() => {
      fakeSockets[1]?.emitClose();
    });
    advance(500);
    expect(fakeSockets).toHaveLength(3);

    // Act — the third socket completes the collaboration handshake.
    const connected = fakeSockets[2];
    if (connected === undefined) throw new Error("expected a third socket");
    act(() => {
      connected.emitOpen();
      connected.emitMessage(publicReadyMessage("doc-reset"));
    });
    expect(result.current.collaborationStatus).toBe("connected");

    // Assert — the next disconnect starts from the shortest window again.
    act(() => {
      connected.emitClose();
    });
    advance(249);
    expect(fakeSockets).toHaveLength(3);
    advance(1);
    expect(fakeSockets).toHaveLength(4);

    unmount();
  });

  it("should not retry while the browser reports itself offline", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-offline");
    const first = await waitForSocket();
    setBrowserOnline(false);

    // Act
    act(() => {
      first.emitClose();
    });

    // Assert — no timer is armed, so no retry can fire while offline.
    expect(result.current.collaborationStatus).toBe("offline");
    advance(60_000);
    expect(fakeSockets).toHaveLength(1);

    // A spurious online event that does not restore connectivity changes nothing.
    emitOnline();
    expect(fakeSockets).toHaveLength(1);

    // A visible page cannot reconnect a browser that has no network either.
    emitVisibilityChange("visible");
    expect(fakeSockets).toHaveLength(1);

    unmount();
  });

  it("should resume reconnecting when connectivity returns", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-online");
    const first = await waitForSocket();
    setBrowserOnline(false);
    act(() => {
      first.emitClose();
    });
    advance(60_000);
    expect(fakeSockets).toHaveLength(1);

    // Act
    setBrowserOnline(true);
    emitOnline();

    // Assert — one reconnect, and no leftover timer adding a second socket.
    expect(fakeSockets).toHaveLength(2);
    advance(60_000);
    expect(fakeSockets).toHaveLength(2);
    expect(fakeSockets[1]?.url).toBe(NITRO_TARGET.documentUrl);

    unmount();
  });

  it("should keep one reconnect timer across repeated close events", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-duplicate-close");
    const first = await waitForSocket();

    // Act — a close, a stray duplicate close, and an error-driven close.
    act(() => {
      first.emitClose();
      first.emitClose();
      first.close();
      first.emitClose();
    });

    // Assert — exactly one reconnect for the whole burst.
    advance(250);
    expect(fakeSockets).toHaveLength(2);
    advance(60_000);
    expect(fakeSockets).toHaveLength(2);

    unmount();
  });

  it("should cancel scheduled reconnect work on unmount", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-unmount");
    const first = await waitForSocket();
    act(() => {
      first.emitClose();
    });

    // Act
    unmount();

    // Assert — neither the armed timer nor a browser signal may open a socket
    // for the disposed document session.
    advance(60_000);
    expect(fakeSockets).toHaveLength(1);
    setBrowserOnline(true);
    emitOnline();
    emitVisibilityChange("visible");
    advance(60_000);
    expect(fakeSockets).toHaveLength(1);
  });

  it("should never disconnect a healthy socket on visibility changes", async () => {
    // Arrange
    const { result, unmount } = renderCollabHook("doc-visibility-healthy");
    const socket = await waitForSocket();
    act(() => {
      socket.emitOpen();
      socket.emitMessage(publicReadyMessage("doc-visibility-healthy"));
    });
    expect(result.current.collaborationStatus).toBe("connected");

    // Act
    emitVisibilityChange("hidden");
    advance(60_000);
    emitVisibilityChange("visible");
    emitOnline();

    // Assert — the live socket is untouched and no second socket appears.
    expect(socket.closeCalls).toEqual([]);
    expect(fakeSockets).toHaveLength(1);
    expect(result.current.collaborationStatus).toBe("connected");

    unmount();
  });

  it("should accelerate a pending reconnect once the page becomes visible", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-visibility-retry");
    const first = await waitForSocket();
    emitVisibilityChange("hidden");
    act(() => {
      first.emitClose();
    });

    // Act — a hidden page keeps waiting out the backoff.
    advance(100);
    emitVisibilityChange("hidden");
    expect(fakeSockets).toHaveLength(1);

    // Assert — becoming visible retries immediately, exactly once: the
    // superseded timer must not open a second socket when it would have fired.
    emitVisibilityChange("visible");
    expect(fakeSockets).toHaveLength(2);
    advance(60_000);
    expect(fakeSockets).toHaveLength(2);

    unmount();
  });

  it("should keep one connection attempt while authentication is in flight", async () => {
    // Arrange — hold the session read open so the attempt cannot complete.
    let releaseSession: (() => void) | undefined;
    authStub.getSession = () =>
      new Promise<FakeSessionResult>((resolve) => {
        releaseSession = () =>
          resolve({
            data: {
              session: { access_token: "token", user: { id: "user-1" } },
            },
            error: null,
          });
      });

    const { unmount } = renderCollabHook("doc-single-attempt", "authenticated");
    await act(async () => {
      await Promise.resolve();
    });
    expect(fakeSockets).toHaveLength(0);

    // Act — every reconnect trigger lands while the attempt is still pending.
    setBrowserOnline(true);
    emitOnline();
    emitVisibilityChange("visible");
    advance(60_000);
    expect(fakeSockets).toHaveLength(0);

    // Assert — completing authentication opens exactly one socket.
    await act(async () => {
      releaseSession?.();
      await Promise.resolve();
    });
    expect(fakeSockets).toHaveLength(1);
    advance(60_000);
    expect(fakeSockets).toHaveLength(1);

    unmount();
  });

  it("should not open a socket for a session disposed while authenticating", async () => {
    // Arrange
    let releaseSession: (() => void) | undefined;
    authStub.getSession = () =>
      new Promise<FakeSessionResult>((resolve) => {
        releaseSession = () =>
          resolve({
            data: {
              session: { access_token: "token", user: { id: "user-1" } },
            },
            error: null,
          });
      });

    const { unmount } = renderCollabHook("doc-disposed-auth", "authenticated");
    await act(async () => {
      await Promise.resolve();
    });

    // Act — the document session goes away before authentication resolves.
    unmount();
    await act(async () => {
      releaseSession?.();
      await Promise.resolve();
    });

    // Assert — a retired attempt can never open a socket for the old document.
    expect(fakeSockets).toHaveLength(0);
    advance(60_000);
    expect(fakeSockets).toHaveLength(0);
  });

  it("should ignore browser reconnect signals after a fatal server error", async () => {
    // Arrange
    const { unmount } = renderCollabHook("doc-fatal-signals");
    const socket = await waitForSocket();
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

    // Act
    setBrowserOnline(true);
    emitOnline();
    emitVisibilityChange("visible");
    advance(60_000);

    // Assert
    expect(fakeSockets).toHaveLength(1);

    unmount();
  });
});
