import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { paperTracePath, type PaperDataset } from "./paper-traces";

/**
 * The expected final text of a paper dataset. Most datasets are checked
 * against the trace's own `endContent`. A dataset whose JSON export cannot
 * reproduce Diamond Types' `endContent` is instead checked against the
 * digest of the paper's reference implementation replaying the same JSON.
 */
export type FinalTextOracle =
  | { readonly kind: "endContent"; readonly text: string }
  | {
      readonly kind: "referenceDigest";
      readonly length: number;
      readonly sha256: string;
    };

export type FinalTextOracleKind = FinalTextOracle["kind"];

export interface ReferenceDigest {
  /** SHA-256 of `datasets/<dataset>.json` the digest was generated from. */
  readonly datasetSha256: string;
  /** Final text length in UTF-16 code units. */
  readonly length: number;
  /** SHA-256 of the UTF-8 encoded final text. */
  readonly sha256: string;
}

export type ReferenceDigests = Readonly<
  Partial<Record<PaperDataset, ReferenceDigest>>
>;

/**
 * A2 is `dt bench-duplicate raw/git-makefile.dt -n2` exported with
 * `dt export-trace`, which renumbers agents and splits some into several
 * slots. DT orders concurrent inserts by agent name, so `endContent` is not
 * reachable from A2.json. The digest below is the eg-walker-reference replay
 * of A2.json at egwalker-paper commit 4d9bef55; regenerate it with
 * `scripts/paper-reference-oracle.mjs`.
 */
export const REFERENCE_DIGESTS: ReferenceDigests = {
  A2: {
    datasetSha256:
      "d81efb97c3316c0b8d9555f26be2fcbe57e70f36b2e5fd38256e636a747bfba0",
    length: 227_352,
    sha256: "3a4da13d6f7ead4357d1a93fec2f6cf58f7a2cbb50aef742c163caef64ed455c",
  },
};

export const sha256Hex = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Pick the oracle for a dataset. Datasets with a pinned reference digest must
 * match the dataset bytes the digest was generated from, so a changed dataset
 * is never validated against a stale digest.
 */
export const finalTextOracleFor = (
  dataset: PaperDataset,
  endContent: string,
  readDatasetBytes: () => Uint8Array,
  digests: ReferenceDigests = REFERENCE_DIGESTS,
): FinalTextOracle => {
  const digest = digests[dataset];
  if (digest === undefined) {
    return { kind: "endContent", text: endContent };
  }

  const datasetSha256 = sha256Hex(readDatasetBytes());
  if (datasetSha256 !== digest.datasetSha256) {
    throw new Error(
      `${dataset}: dataset sha256 ${datasetSha256} does not match the pinned reference digest input ${digest.datasetSha256}; regenerate it with scripts/paper-reference-oracle.mjs`,
    );
  }
  return {
    kind: "referenceDigest",
    length: digest.length,
    sha256: digest.sha256,
  };
};

export const loadFinalTextOracle = (
  paperRoot: string,
  dataset: PaperDataset,
  endContent: string,
  digests: ReferenceDigests = REFERENCE_DIGESTS,
): FinalTextOracle =>
  finalTextOracleFor(
    dataset,
    endContent,
    () => readFileSync(paperTracePath(paperRoot, dataset)),
    digests,
  );

interface TextDifference {
  readonly index: number;
  readonly actualContext: string;
  readonly expectedContext: string;
}

export const describeTextDifference = (
  actual: string,
  expected: string,
): TextDifference => {
  const sharedLength = Math.min(actual.length, expected.length);
  let index = 0;
  while (
    index < sharedLength &&
    actual.charCodeAt(index) === expected.charCodeAt(index)
  ) {
    index++;
  }
  const contextStart = Math.max(0, index - 80);
  const contextEnd = index + 160;
  return {
    index,
    actualContext: actual.slice(contextStart, contextEnd),
    expectedContext: expected.slice(contextStart, contextEnd),
  };
};

/**
 * Throw when `text` does not satisfy the oracle. Length is checked first, then
 * either exact equality (`endContent`) or the SHA-256 of the UTF-8 text.
 */
export const assertFinalText = (
  label: string,
  text: string,
  oracle: FinalTextOracle,
): void => {
  const expectedLength =
    oracle.kind === "endContent" ? oracle.text.length : oracle.length;
  const mismatch = `${label}: final text mismatch, got ${text.length} UTF-16 code units, expected ${expectedLength}`;

  if (oracle.kind === "endContent") {
    if (text === oracle.text) {
      return;
    }
    const difference = describeTextDifference(text, oracle.text);
    throw new Error(
      [
        mismatch,
        `first difference at ${difference.index}`,
        `actual ${JSON.stringify(difference.actualContext)}`,
        `expected ${JSON.stringify(difference.expectedContext)}`,
      ].join("; "),
    );
  }

  if (text.length !== oracle.length) {
    throw new Error(`${mismatch} (reference digest)`);
  }
  const actualSha256 = sha256Hex(text);
  if (actualSha256 !== oracle.sha256) {
    throw new Error(
      `${mismatch}; reference sha256 ${oracle.sha256}, got ${actualSha256}`,
    );
  }
};
