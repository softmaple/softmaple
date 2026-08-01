import { describe, expect, it } from "vitest";
import { createRoomId } from "./room";

describe("Lexical EG-walker demo", () => {
  it("creates URL-safe room identifiers", () => {
    expect(createRoomId()).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
  });
});
