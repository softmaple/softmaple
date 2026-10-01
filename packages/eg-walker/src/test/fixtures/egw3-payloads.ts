import { OPERATION_TYPE } from "../../constants/operation-types";
import type { ExternalOperation } from "../../types";

/*
 * EGW3 payloads written by the last EGW3 encoder (commit c5baf54), kept
 * byte for byte so EGW4 builds prove they still read stored documents.
 * Never regenerate them with a newer encoder: they exist to pin the old
 * bytes.
 */

export interface Egw3FixtureEvent {
  readonly id: string;
  readonly parents: ReadonlyArray<string>;
  readonly operation: ExternalOperation;
  readonly timestamp: number;
}

export interface Egw3GraphFixture {
  readonly base64: string;
  /** The encoded events, in wire order. */
  readonly events: ReadonlyArray<Egw3FixtureEvent>;
  readonly frontier: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Text of the graph replayed from an empty document. */
  readonly text: string;
}

export interface Egw3SnapshotFixture {
  readonly base64: string;
  readonly text: string;
  readonly eventCount: number;
}

/** One author typing and deleting, with a non-BMP character and metadata. */
export const EGW3_LINEAR_GRAPH: Egw3GraphFixture = {
  base64:
    "BEVHVzMBB2FsaWNlOjUDAQMCAgEBBgAKDAABAAYFBgICAQIhBCJNGEBw3xIAAIBI" +
    "ZWxsbyB3w7ZybGTwn5iAZCEAAAAAAAEFYWxpY2UADAaAoKv++WLwAYQCAqoCAhN7" +
    "InRpdGxlIjoiZml4dHVyZSJ9",
  events: [
    {
      id: "alice:0",
      parents: [],
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
      timestamp: 1700000000000,
    },
    {
      id: "alice:1",
      parents: ["alice:0"],
      operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " w\u00f6rld" },
      timestamp: 1700000000120,
    },
    {
      id: "alice:2",
      parents: ["alice:1"],
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 11,
        text: "\ud83d\ude00",
      },
      timestamp: 1700000000250,
    },
    {
      id: "alice:3",
      parents: ["alice:2"],
      operation: { type: OPERATION_TYPE.DELETE, index: 11, length: 2 },
      timestamp: 1700000000251,
    },
    {
      id: "alice:4",
      parents: ["alice:3"],
      operation: { type: OPERATION_TYPE.DELETE, index: 10, length: 1 },
      timestamp: 1700000000400,
    },
    {
      id: "alice:5",
      parents: ["alice:4"],
      operation: { type: OPERATION_TYPE.INSERT, index: 10, text: "d!" },
      timestamp: 1700000000401,
    },
  ],
  frontier: ["alice:5"],
  metadata: { title: "fixture" },
  text: "Hello w\u00f6rld!",
};

/**
 * Two concurrent roots, a merge with a custom ID, a sequence gap, a
 * zero-length delete, a leading U+FEFF and negative and 2^40 timestamps.
 */
export const EGW3_CONCURRENT_GRAPH: Egw3GraphFixture = {
  base64:
    "BEVHVzMCB2FsaWNlOjIFYm9iOjUFAQMCAQEBAgEBAQcABAMAAAIABwIBAQEBAAIY" +
    "BCJNGEBw3wkAAIBhYmNYTe+7v3kAAAAAAwIAAQIHYWxpY2U6MQVib2I6MQEBDGxl" +
    "Z2FjeS1tZXJnZQUFYWxpY2UABANib2IABAxsZWdhY3ktbWVyZ2UAAwVhbGljZQIC" +
    "A2JvYgUCBxQEAQQjioCAgIBA//////8/Ant9",
  events: [
    {
      id: "alice:0",
      parents: [],
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "ab" },
      timestamp: 10,
    },
    {
      id: "alice:1",
      parents: ["alice:0"],
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "c" },
      timestamp: 12,
    },
    {
      id: "bob:0",
      parents: [],
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
      timestamp: 11,
    },
    {
      id: "bob:1",
      parents: ["bob:0"],
      operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
      timestamp: 13,
    },
    {
      id: "legacy-merge",
      parents: ["alice:1", "bob:1"],
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
      timestamp: -5,
    },
    {
      id: "alice:2",
      parents: ["legacy-merge"],
      operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 0 },
      timestamp: 2 ** 40,
    },
    {
      id: "bob:5",
      parents: ["legacy-merge"],
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "\ufeffy" },
      timestamp: 0,
    },
  ],
  frontier: ["alice:2", "bob:5"],
  metadata: {},
  text: "M\ufeffyabc",
};

/** `EGWP1` portable snapshot of a two-replica merge; its graph is EGW3. */
export const EGWP1_WITH_EGW3_GRAPH: Egw3SnapshotFixture = {
  base64:
    "RUdXUDGIAXsiZm9ybWF0VmVyc2lvbiI6IkVHV1AxIiwidGV4dCI6IkhlbGxvLCBF" +
    "R1czIPCfmYIuIiwiaW5pdGlhbFRleHQiOiIiLCJjdXJyZW50VmVyc2lvbiI6WyJh" +
    "bGljZToyIl0sImV2ZW50Q291bnQiOjUsIm5leHRTZXF1ZW5jZU51bWJlciI6M32H" +
    "AQRFR1czAQdhbGljZToyAwECAgEBAgUACgIAEAULAQUHASUEIk0YQHDfFgAAgEhl" +
    "bGxvIHdvcmxkLEVHVzMg8J+Zgi4AAAAAAgIBB2FsaWNlOjABAgdhbGljZToxBWJv" +
    "YjoxAwVhbGljZQAEA2JvYgAEBWFsaWNlAgIF2r6d455oAgIACgJ7fQ==",
  text: "Hello, EGW3 \ud83d\ude42.",
  eventCount: 5,
};

/** `EGWS1` native snapshot of the same replica; its graph is EGW3. */
export const EGWS1_WITH_EGW3_GRAPH: Egw3SnapshotFixture = {
  base64:
    "RUdXUzGIA3siZm9ybWF0VmVyc2lvbiI6IkVHV1MxIiwidGV4dCI6IkhlbGxvLCBF" +
    "R1czIPCfmYIuIiwiaW5pdGlhbFRleHQiOiIiLCJjdXJyZW50VmVyc2lvbiI6WyJh" +
    "bGljZToyIl0sImV2ZW50Q291bnQiOjUsIm5leHRTZXF1ZW5jZU51bWJlciI6Mywi" +
    "bWV0YWRhdGEiOnsiaW5pdGlhbFRleHQiOiIiLCJuZXh0U2VxdWVuY2VOdW1iZXIi" +
    "OjN9LCJjaGVja3BvaW50cyI6W3sidmVyc2lvbiI6WyJhbGljZTowIl0sInRleHQi" +
    "OiJIZWxsbyB3b3JsZCIsImV2ZW50Q291bnQiOjF9LHsidmVyc2lvbiI6WyJhbGlj" +
    "ZToxIl0sInRleHQiOiJIZWxsbywgd29ybGQiLCJldmVudENvdW50IjoyfSx7InZl" +
    "cnNpb24iOlsiYWxpY2U6MiJdLCJ0ZXh0IjoiSGVsbG8sIEVHVzMg8J+Zgi4iLCJl" +
    "dmVudENvdW50Ijo1fV19rgEERUdXMwEHYWxpY2U6MgMBAgIBAQIFAAoCABAFCwEF" +
    "BwElBCJNGEBw3xYAAIBIZWxsbyB3b3JsZCxFR1czIPCfmYIuAAAAAAICAQdhbGlj" +
    "ZTowAQIHYWxpY2U6MQVib2I6MQMFYWxpY2UABANib2IABAVhbGljZQICBdq+neOe" +
    "aAICAAopeyJpbml0aWFsVGV4dCI6IiIsIm5leHRTZXF1ZW5jZU51bWJlciI6M33r" +
    "AUVHV1IyCxFfX3BsYWNlaG9sZGVyX186MA9fX3BsYWNlaG9sZGVyX18JYWxpY2U6" +
    "MTowB2FsaWNlOjERX19wbGFjZWhvbGRlcl9fOjEHYm9iOjE6MAVib2I6MQlhbGlj" +
    "ZToyOjAHYWxpY2U6MhFfX3BsYWNlaG9sZGVyX186MgVib2I6MAEFYWxpY2UGBgAE" +
    "BAIEBAYCBAMKBA0GAAIBCgILBgAAAAAAAAYAAAAAAAEGAQEBAQECBgACAQACAQYA" +
    "AgEABAMHAAoCAhICChZIZWxsbywgRUdXMyDwn5mCLndvcmxkAQEUAgACARI=",
  text: "Hello, EGW3 \ud83d\ude42.",
  eventCount: 5,
};
