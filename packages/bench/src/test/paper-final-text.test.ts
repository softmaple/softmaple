import { describe, expect, it } from "vitest";

import {
  assertFinalText,
  finalTextOracleFor,
  REFERENCE_DIGESTS,
  sha256Hex,
  type ReferenceDigests,
} from "../bench/paper-final-text";
import { PAPER_DATASETS } from "../bench/paper-traces";

const datasetBytes = new TextEncoder().encode('{"txns":[]}');
const referenceText = "AM_OBJS))\n\nTEST_BUILTINS_OBJS 😀";
const digests: ReferenceDigests = {
  A2: {
    datasetSha256: sha256Hex(datasetBytes),
    length: referenceText.length,
    sha256: sha256Hex(referenceText),
  },
};
const readDatasetBytes = (): Uint8Array => datasetBytes;
const referenceOracle = finalTextOracleFor(
  "A2",
  "unused endContent",
  readDatasetBytes,
  digests,
);

describe("paper final text oracle", () => {
  it("selects the reference digest for A2 and endContent for the rest", () => {
    // Arrange
    const readBytes = (): Uint8Array => {
      throw new Error("endContent datasets must not read dataset bytes");
    };

    // Act
    const kinds = PAPER_DATASETS.map((dataset) =>
      dataset === "A2"
        ? finalTextOracleFor(dataset, "end", readDatasetBytes, digests).kind
        : finalTextOracleFor(dataset, "end", readBytes, digests).kind,
    );

    // Assert
    expect(Object.keys(REFERENCE_DIGESTS)).toEqual(["A2"]);
    expect(kinds).toEqual([
      "endContent",
      "endContent",
      "endContent",
      "endContent",
      "endContent",
      "endContent",
      "referenceDigest",
    ]);
  });

  it("accepts the reference text", () => {
    expect(() =>
      assertFinalText("A2", referenceText, referenceOracle),
    ).not.toThrow();
  });

  it("rejects a same-length text with one corrupted character", () => {
    // Arrange
    const corrupted = `${referenceText.slice(0, 10)} ${referenceText.slice(11)}`;

    // Act + Assert
    expect(corrupted).toHaveLength(referenceText.length);
    expect(() => assertFinalText("A2", corrupted, referenceOracle)).toThrow(
      /A2: final text mismatch.*reference sha256/,
    );
  });

  it("rejects a text of a different length", () => {
    expect(() =>
      assertFinalText("A2", `${referenceText}!`, referenceOracle),
    ).toThrow(
      `A2: final text mismatch, got ${referenceText.length + 1} UTF-16 code units, expected ${referenceText.length}`,
    );
  });

  it("rejects dataset bytes the digest was not generated from", () => {
    // Arrange
    const changedBytes = (): Uint8Array =>
      new TextEncoder().encode('{"txns":[{}]}');

    // Act + Assert
    expect(() =>
      finalTextOracleFor("A2", "end", changedBytes, digests),
    ).toThrow(/A2: dataset sha256 .* does not match/);
  });

  it("reports the first difference for endContent oracles", () => {
    // Arrange
    const oracle = finalTextOracleFor(
      "S1",
      "abcdef",
      readDatasetBytes,
      digests,
    );

    // Act + Assert
    expect(() => assertFinalText("S1", "abcdef", oracle)).not.toThrow();
    expect(() => assertFinalText("S1", "abXdef", oracle)).toThrow(
      /S1: final text mismatch.*first difference at 2/,
    );
  });
});
