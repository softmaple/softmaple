import { describe, expect, it } from "vitest";
import {
  closeCollabClientSocket,
  COLLAB_CLIENT_CLOSE_CODE,
  isBrowserAllowedWebSocketCloseCode,
} from "./collab-client-close";

/** Mirrors Chromium's WebSocket.close() close-code validation. */
const assertBrowserWebSocketCloseCode = (code: number | undefined): void => {
  if (code === undefined) return;
  if (code === 1000 || (code >= 3000 && code <= 4999)) return;
  throw new DOMException(
    `Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
    "InvalidAccessError",
  );
};

describe("COLLAB_CLIENT_CLOSE_CODE", () => {
  it("should use distinct application codes in the 4000–4999 range", () => {
    // Arrange
    const codes = Object.values(COLLAB_CLIENT_CLOSE_CODE);

    // Assert
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
      expect(isBrowserAllowedWebSocketCloseCode(code)).toBe(true);
    }
  });

  it("should be accepted by a browser-faithful WebSocket.close mock", () => {
    // Arrange
    const closed: Array<{ code: number; reason: string }> = [];
    const socket = {
      close: (code?: number, reason?: string) => {
        assertBrowserWebSocketCloseCode(code);
        if (code !== undefined) {
          closed.push({ code, reason: reason ?? "" });
        }
      },
    };

    // Act
    closeCollabClientSocket(
      socket,
      COLLAB_CLIENT_CLOSE_CODE.InvalidServerResponse,
      "Invalid collaboration response",
    );
    closeCollabClientSocket(
      socket,
      COLLAB_CLIENT_CLOSE_CODE.RetryableServerError,
      "Retry collaboration sync",
    );
    closeCollabClientSocket(
      socket,
      COLLAB_CLIENT_CLOSE_CODE.FatalServerError,
      "Fatal error",
    );
    closeCollabClientSocket(
      socket,
      COLLAB_CLIENT_CLOSE_CODE.ResponseApplyFailure,
      "Collaboration response could not be applied",
    );

    // Assert
    expect(closed).toEqual([
      {
        code: COLLAB_CLIENT_CLOSE_CODE.InvalidServerResponse,
        reason: "Invalid collaboration response",
      },
      {
        code: COLLAB_CLIENT_CLOSE_CODE.RetryableServerError,
        reason: "Retry collaboration sync",
      },
      {
        code: COLLAB_CLIENT_CLOSE_CODE.FatalServerError,
        reason: "Fatal error",
      },
      {
        code: COLLAB_CLIENT_CLOSE_CODE.ResponseApplyFailure,
        reason: "Collaboration response could not be applied",
      },
    ]);
  });
});

describe("isBrowserAllowedWebSocketCloseCode", () => {
  it("should allow 1000 and the application/private ranges", () => {
    expect(isBrowserAllowedWebSocketCloseCode(1000)).toBe(true);
    expect(isBrowserAllowedWebSocketCloseCode(3000)).toBe(true);
    expect(isBrowserAllowedWebSocketCloseCode(4999)).toBe(true);
  });

  it("should reject protocol codes that browsers forbid for client close()", () => {
    for (const code of [1001, 1008, 1011, 1013, 2999]) {
      expect(isBrowserAllowedWebSocketCloseCode(code)).toBe(false);
      expect(() => assertBrowserWebSocketCloseCode(code)).toThrow(DOMException);
    }
  });
});

describe("closeCollabClientSocket", () => {
  it("should not let a close() InvalidAccessError escape to callers", () => {
    // Arrange — simulate a browser rejecting the close invocation
    const socket = {
      close: () => {
        throw new DOMException(
          "Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. 1008 is neither.",
          "InvalidAccessError",
        );
      },
    };

    // Act / Assert — helper swallows the browser exception
    expect(() =>
      closeCollabClientSocket(
        socket,
        COLLAB_CLIENT_CLOSE_CODE.FatalServerError,
        "Fatal error",
      ),
    ).not.toThrow();
  });
});
