import { afterEach, describe, expect, it } from "vitest";
import { buildRoomUrl, clearRoomLocalData } from "./roomLink";

describe("room link helpers", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("injects the room query param without dropping other params", () => {
    expect(
      buildRoomUrl(
        "maple-abc",
        "https://playground.softmaple.ink/demo/lexical-eg-walker?transport=websocket",
      ),
    ).toBe(
      "https://playground.softmaple.ink/demo/lexical-eg-walker?transport=websocket&room=maple-abc",
    );
  });

  it("clears matching localStorage keys for a room", () => {
    localStorage.setItem("softmaple:lexical-eg-walker:v1:room:maple-abc", "{}");
    localStorage.setItem("unrelated", "1");
    expect(clearRoomLocalData("maple-abc")).toBe(1);
    expect(localStorage.getItem("unrelated")).toBe("1");
    expect(
      localStorage.getItem("softmaple:lexical-eg-walker:v1:room:maple-abc"),
    ).toBeNull();
  });
});
