import { describe, expect, it } from "vitest";
import { supabaseQueryError } from "../src/supabase-error";

describe("supabaseQueryError", () => {
  // postgrest-js only builds a `PostgrestError` (which extends Error) on its
  // shouldThrowOnError path; the `{ data, error }` result carries a plain
  // object, so re-throwing it verbatim produced `errorName: "UnknownError"`
  // and `error: "[object Object]"` in the Worker logs.
  it("turns a plain PostgREST result error into a named Error", () => {
    const wrapped = supabaseQueryError("presence membership lookup", {
      code: "42501",
      details: null,
      hint: null,
      message: "permission denied for table workspace_members",
    });

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.name).toBe("SupabaseQueryError");
    expect(wrapped.message).toBe(
      "presence membership lookup failed: 42501 | permission denied for table workspace_members",
    );
  });

  it("keeps every non-empty PostgREST field in order", () => {
    expect(
      supabaseQueryError("presence document lookup", {
        code: "PGRST116",
        details: "Results contain 0 rows",
        hint: "Check the filter",
        message: "JSON object requested",
      }).message,
    ).toBe(
      "presence document lookup failed: PGRST116 | JSON object requested | Results contain 0 rows | Check the filter",
    );
  });

  it("returns a real Error unchanged so its stack survives", () => {
    const original = new TypeError("fetch failed");
    expect(supabaseQueryError("presence profile lookup", original)).toBe(
      original,
    );
  });

  it("describes a value carrying no recognizable fields", () => {
    expect(supabaseQueryError("presence document lookup", {}).message).toBe(
      "presence document lookup failed: {}",
    );
    expect(supabaseQueryError("presence document lookup", null).message).toBe(
      "presence document lookup failed: null",
    );
  });
});
