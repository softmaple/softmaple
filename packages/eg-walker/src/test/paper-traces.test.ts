import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  convertPaperTraceToEvents,
  type PaperTrace,
} from "../bench/paper-traces";

const traceWithNonBmpCharacter: PaperTrace = {
  kind: "sequential",
  endContent: "a😀",
  numAgents: 1,
  txns: [
    {
      parents: [],
      numChildren: 0,
      agent: 0,
      patches: [
        [0, 0, "a😀b"],
        [2, 1, ""],
      ],
      _dtSpan: [0, 4],
    },
  ],
};

describe("paper trace conversion", () => {
  it("converts paper code-point offsets to UTF-16 offsets in patch mode", () => {
    const events = convertPaperTraceToEvents(
      "S3",
      traceWithNonBmpCharacter,
      "patch",
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 0,
      text: "a😀b",
    });
    expect(events[1]?.operation).toEqual({
      type: OPERATION_TYPE.DELETE,
      index: 3,
      length: 1,
    });
  });

  it("converts paper code-point offsets to UTF-16 offsets in operation mode", () => {
    const events = convertPaperTraceToEvents(
      "S3",
      traceWithNonBmpCharacter,
      "operation",
    );

    expect(events.map((event) => event.operation)).toEqual([
      {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "a",
      },
      {
        type: OPERATION_TYPE.INSERT,
        index: 1,
        text: "😀",
      },
      {
        type: OPERATION_TYPE.INSERT,
        index: 3,
        text: "b",
      },
      {
        type: OPERATION_TYPE.DELETE,
        index: 3,
        length: 1,
      },
    ]);
    expect(events.map((event) => event.id)).toEqual([
      "paper:S3:agent:number:0000000000000000:0",
      "paper:S3:agent:number:0000000000000000:1",
      "paper:S3:agent:number:0000000000000000:2",
      "paper:S3:agent:number:0000000000000000:3",
    ]);
  });
});
