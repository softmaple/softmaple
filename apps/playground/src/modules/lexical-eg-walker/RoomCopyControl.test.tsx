import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomCopyControl } from "./RoomCopyControl";

describe("room copy control", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows bounded copied feedback after clipboard write succeeds", async () => {
    vi.useFakeTimers();
    const onCopyRoomLink = vi.fn(() => Promise.resolve());

    render(
      <RoomCopyControl roomId="sample-room" onCopyRoomLink={onCopyRoomLink} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy link for room sample-room",
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onCopyRoomLink).toHaveBeenCalledOnce();
    expect(screen.getByText("Copied").textContent).toBe("Copied");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("does not show copied feedback when clipboard write is rejected", async () => {
    const onCopyRoomLink = vi.fn(() =>
      Promise.reject(new Error("clipboard write failed")),
    );

    render(
      <RoomCopyControl roomId="sample-room" onCopyRoomLink={onCopyRoomLink} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy link for room sample-room",
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onCopyRoomLink).toHaveBeenCalledOnce();
    expect(screen.queryByText("Copied")).toBeNull();
  });
});
