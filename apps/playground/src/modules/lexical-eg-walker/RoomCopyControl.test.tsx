import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomCopyControl } from "./RoomCopyControl";

describe("room copy control", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows bounded copied feedback after invoking the copy action", () => {
    vi.useFakeTimers();
    const onCopyRoomLink = vi.fn();

    render(
      <RoomCopyControl roomId="sample-room" onCopyRoomLink={onCopyRoomLink} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy link for room sample-room",
      }),
    );

    expect(onCopyRoomLink).toHaveBeenCalledOnce();
    expect(screen.getByText("Copied").textContent).toBe("Copied");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByText("Copied")).toBeNull();
  });
});
