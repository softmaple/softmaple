// Regenerate a paper-bench reference digest (see src/bench/paper-final-text.ts).
//
// Replays datasets/<dataset>.json with the paper's TypeScript reference
// implementation and prints the dataset SHA-256 plus the final text length and
// SHA-256. Build the reference first:
//
//   cd ../egwalker-paper/eg-walker-reference && npm install && npx tsc -p .
//   node packages/bench/scripts/paper-reference-oracle.mjs --dataset A2
//
// A2 takes about 7 minutes and needs a large stack and heap; the script
// re-executes itself with both when they are missing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD_FLAG = "--paper-reference-oracle-child";

const parseArgs = (argv) => {
  const options = {
    dataset: "A2",
    paperRoot: resolve(packageRoot, "../../..", "egwalker-paper"),
    child: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dataset") {
      options.dataset = argv[++index];
    } else if (arg === "--paper-root") {
      options.paperRoot = resolve(argv[++index]);
    } else if (arg === CHILD_FLAG) {
      options.child = true;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return options;
};

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The bench converter zero-pads numeric agents so string order equals numeric
// order. The reference tie-breaks concurrent inserts by agent string, so it
// needs the same padding to produce the same document.
const agentName = (agent) =>
  typeof agent === "number" ? agent.toString().padStart(7, "0") : agent;

const replay = (frh, trace) => {
  const oplog = frh.createOpLog();
  const nextSeqByAgent = new Map();
  const txnVersions = [];

  for (const [txnIndex, txn] of trace.txns.entries()) {
    const agent = agentName(txn.agent);
    let seq = nextSeqByAgent.get(agent) ?? 0;
    const version = new Map();
    for (const parent of txn.parents) {
      const parentVersion = txnVersions[parent];
      if (parentVersion === undefined) {
        throw new Error(`txn ${txnIndex} references unknown parent ${parent}`);
      }
      for (const [key, rawVersion] of parentVersion) {
        version.set(key, rawVersion);
      }
    }
    let parents = [...version.values()];

    const push = (type, pos, content) => {
      const id = [agent, seq++];
      frh.pushOp(oplog, id, parents, type, pos, content);
      parents = [id];
    };
    for (const [pos, deleteLength, insertedText] of txn.patches) {
      for (let offset = 0; offset < deleteLength; offset++) {
        push("del", pos);
      }
      let insertPos = pos;
      for (const character of insertedText) {
        push("ins", insertPos++, character);
      }
    }

    nextSeqByAgent.set(agent, seq);
    txnVersions.push(
      new Map(parents.map((rawVersion) => [rawVersion.join("\u0000"), rawVersion])),
    );
  }

  return frh.checkoutSimpleString(oplog);
};

const options = parseArgs(process.argv.slice(2));

if (!options.child) {
  const result = spawnSync(
    process.execPath,
    [
      "--stack-size=65500",
      "--max-old-space-size=8192",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
      CHILD_FLAG,
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const referenceEntry = join(
  options.paperRoot,
  "eg-walker-reference/dist/src/index.js",
);
if (!existsSync(referenceEntry)) {
  throw new Error(
    `Missing ${referenceEntry}; run npm install && npx tsc -p . in eg-walker-reference first`,
  );
}
const frh = await import(pathToFileURL(referenceEntry).href);
const datasetPath = join(options.paperRoot, "datasets", `${options.dataset}.json`);
const datasetBytes = readFileSync(datasetPath);
const trace = JSON.parse(datasetBytes.toString("utf8"));

const startedAt = performance.now();
const text = replay(frh, trace);
const elapsedMs = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      dataset: options.dataset,
      datasetSha256: sha256Hex(datasetBytes),
      length: text.length,
      sha256: sha256Hex(text),
      matchesEndContent: text === trace.endContent,
      elapsedMs: Math.round(elapsedMs),
    },
    null,
    2,
  ),
);
