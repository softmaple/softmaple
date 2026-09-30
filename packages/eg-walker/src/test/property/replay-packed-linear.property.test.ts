import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import {
  MIN_TRANSIENT_CHAIN_EVENTS,
  replayPackedLinear,
} from "../../core/internals/replay-packed-linear";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import {
  EventGraph,
  type PackedLinearReplayView,
} from "../../graph/event-graph";
import { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import type { ExternalOperation } from "../../types";
import { surrogateBiasedTextArb } from "./arbitraries";
import { fcParams } from "./run-config";

/**
 * One edit before it is resolved against the text it applies to. `type` and
 * `forwardDelete` edit at the end of the previous edit, so runs of them are
 * what the replay coalesces.
 */
type EditInstruction =
  | {
      readonly kind: "insert";
      readonly positionSeed: number;
      readonly text: string;
    }
  | { readonly kind: "type"; readonly text: string }
  | {
      readonly kind: "delete";
      readonly positionSeed: number;
      readonly lengthSeed: number;
    }
  | { readonly kind: "forwardDelete"; readonly lengthSeed: number };

/** An edit the replay must reject, resolved against the script's final text. */
type InvalidEdit =
  | { readonly kind: "insertPastEnd"; readonly overshoot: number }
  | {
      readonly kind: "deletePastEnd";
      readonly positionSeed: number;
      readonly overshoot: number;
    }
  | {
      readonly kind: "splitPair";
      readonly positionSeed: number;
      readonly edit: "insert" | "deleteFrom" | "deleteInto";
    };

const insertTextArb = fc.oneof(fc.constant(""), surrogateBiasedTextArb());

const editInstructionArb: fc.Arbitrary<EditInstruction> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    positionSeed: fc.nat(),
    text: insertTextArb,
  }),
  fc.record({ kind: fc.constant("type" as const), text: insertTextArb }),
  fc.record({
    kind: fc.constant("delete" as const),
    positionSeed: fc.nat(),
    lengthSeed: fc.nat(),
  }),
  fc.record({
    kind: fc.constant("forwardDelete" as const),
    lengthSeed: fc.nat(),
  }),
);

const invalidEditArb: fc.Arbitrary<InvalidEdit> = fc.oneof(
  fc.record({
    kind: fc.constant("insertPastEnd" as const),
    overshoot: fc.nat(),
  }),
  fc.record({
    kind: fc.constant("deletePastEnd" as const),
    positionSeed: fc.nat(),
    overshoot: fc.nat(),
  }),
  fc.record({
    kind: fc.constant("splitPair" as const),
    positionSeed: fc.nat(),
    edit: fc.constantFrom("insert", "deleteFrom", "deleteInto"),
  }),
);

const initialTextArb = fc.constantFrom("", "a🙂é", "👩‍💻");

// Long enough that a window can cover the piece-index path, not only the
// direct persistent-rope path used below MIN_TRANSIENT_CHAIN_EVENTS.
const scriptArb = fc.array(editInstructionArb, {
  minLength: MIN_TRANSIENT_CHAIN_EVENTS,
});

// Few cuts, so most windows stay long enough for the piece index while a cut
// still hands a frozen rope to the next window.
const cutsArb = fc.array(fc.nat(), { size: "-1" });

describe("replayPackedLinear", () => {
  it("should replay consecutive windows of a script to the text of its edits applied one by one", () => {
    fc.assert(
      fc.property(
        initialTextArb,
        scriptArb,
        cutsArb,
        (initialText, instructions, cuts) => {
          // Arrange
          const { operations, texts } = resolveScript(
            initialText,
            instructions,
          );
          const packed = packLinearChain(operations);
          const ends = windowEnds(operations.length, cuts);

          // Act
          let document = PersistentUtf16Rope.from(initialText);
          let start = 0;
          const replayed: string[] = [];
          for (const end of ends) {
            document = replayPackedLinear(packed, document, end, start);
            replayed.push(document.toString());
            start = end;
          }

          // Assert
          expect(replayed).toEqual(ends.map((end) => texts[end]));
        },
      ),
      fcParams(),
    );
  });

  it("should reject a window whose last edit splits a surrogate pair or passes the end", () => {
    fc.assert(
      fc.property(
        initialTextArb,
        scriptArb,
        invalidEditArb,
        fc.nat(),
        (initialText, instructions, invalid, startSeed) => {
          // Arrange
          const { operations, texts } = resolveScript(
            initialText,
            instructions,
          );
          const { edits, error } = resolveInvalidEdit(
            texts[texts.length - 1]!,
            invalid,
          );
          const packed = packLinearChain([...operations, ...edits]);
          const start = startSeed % (operations.length + 1);
          const document = PersistentUtf16Rope.from(texts[start]!);

          // Act
          const replay = (): PersistentUtf16Rope =>
            replayPackedLinear(packed, document, packed.count, start);

          // Assert
          expect(replay).toThrow(error);
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

interface ResolvedScript {
  readonly operations: ReadonlyArray<ExternalOperation>;
  /** `texts[offset]` is the text before operation `offset`. */
  readonly texts: ReadonlyArray<string>;
}

/** Resolve seeds to edits that keep every index on a code-point boundary. */
const resolveScript = (
  initialText: string,
  instructions: ReadonlyArray<EditInstruction>,
): ResolvedScript => {
  const scalars = Array.from(initialText);
  const operations: ExternalOperation[] = [];
  const texts = [initialText];
  let cursor = scalars.length;

  for (const instruction of instructions) {
    const at =
      instruction.kind === "type" || instruction.kind === "forwardDelete"
        ? cursor
        : instruction.positionSeed % (scalars.length + 1);
    const index = scalars.slice(0, at).join("").length;

    if (instruction.kind === "insert" || instruction.kind === "type") {
      const inserted = Array.from(instruction.text);
      scalars.splice(at, 0, ...inserted);
      operations.push({
        type: OPERATION_TYPE.INSERT,
        index,
        text: instruction.text,
      });
      cursor = at + inserted.length;
    } else {
      const removed = scalars.splice(
        at,
        instruction.lengthSeed % (scalars.length - at + 1),
      );
      operations.push({
        type: OPERATION_TYPE.DELETE,
        index,
        length: removed.join("").length,
      });
      cursor = at;
    }
    texts.push(scalars.join(""));
  }

  return { operations, texts };
};

/** Build the rejected edit, preceded by the pair it splits if it needs one. */
const resolveInvalidEdit = (
  text: string,
  invalid: InvalidEdit,
): {
  readonly edits: ReadonlyArray<ExternalOperation>;
  readonly error: RegExp;
} => {
  if (invalid.kind === "insertPastEnd") {
    return {
      edits: [
        {
          type: OPERATION_TYPE.INSERT,
          index: text.length + 1 + invalid.overshoot,
          text: "x",
        },
      ],
      error: /out of bounds/,
    };
  }

  const boundaries = codePointBoundaries(text);
  const index = boundaries[invalid.positionSeed % boundaries.length]!;
  if (invalid.kind === "deletePastEnd") {
    return {
      edits: [
        {
          type: OPERATION_TYPE.DELETE,
          index,
          length: text.length - index + 1 + invalid.overshoot,
        },
      ],
      error: /out of bounds|exceeds document length/,
    };
  }

  const pair: ExternalOperation = {
    type: OPERATION_TYPE.INSERT,
    index,
    text: "🙂",
  };
  const split: ExternalOperation =
    invalid.edit === "insert"
      ? { type: OPERATION_TYPE.INSERT, index: index + 1, text: "x" }
      : invalid.edit === "deleteFrom"
        ? { type: OPERATION_TYPE.DELETE, index: index + 1, length: 1 }
        : { type: OPERATION_TYPE.DELETE, index, length: 1 };
  return { edits: [pair, split], error: /between surrogate halves/ };
};

const codePointBoundaries = (text: string): number[] => {
  const boundaries = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    boundaries.push(offset);
  }
  return boundaries;
};

/** Sorted, distinct window ends in `(0, count]`, always ending at `count`. */
const windowEnds = (count: number, cuts: ReadonlyArray<number>): number[] =>
  [...new Set([...cuts.map((cut) => cut % (count + 1)), count])]
    .filter((end) => end > 0)
    .sort((left, right) => left - right);

const packLinearChain = (
  operations: ReadonlyArray<ExternalOperation>,
): PackedLinearReplayView => {
  const graph = new EventGraph();
  operations.forEach((operation, offset) =>
    graph.addEvent({
      id: `linear:${offset}`,
      parentVersion:
        offset === 0 ? new Set() : new Set([`linear:${offset - 1}`]),
      operation,
      timestamp: offset,
    }),
  );
  const codec = new ColumnarEventGraphCodec();
  const packed = codec
    .decodeBinary(codec.encodeBinary(graph))
    .getPackedLinearReplayView();
  if (packed === null) {
    throw new Error("A decoded exact chain must expose a packed replay view");
  }
  return packed;
};
