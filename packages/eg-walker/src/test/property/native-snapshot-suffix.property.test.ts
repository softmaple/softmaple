/**
 * Property: a native snapshot restored from compact runtime state can accept
 * additional local and remote suffixes and still match a full replay of the
 * final event graph.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { NativeSnapshotCodec } from "../../core/native-snapshot";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import {
  bmpTextArb,
  localEditScriptArb,
  traceParamsArb,
  type EditInstruction,
} from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

const snapshotSuffixArb = traceParamsArb({
  minReplicas: 2,
  maxReplicas: 3,
  minStepsPerReplica: 1,
  maxStepsPerReplica: 4,
}).chain((base) =>
  fc.record({
    base: fc.constant(base),
    localSuffix: localEditScriptArb({
      minSteps: 0,
      maxSteps: 3,
      textArb: bmpTextArb({ maxLength: 3 }),
    }),
    remoteSuffix: traceParamsArb({
      minReplicas: 2,
      maxReplicas: 3,
      minStepsPerReplica: 1,
      maxStepsPerReplica: 3,
      seedTextArb: fc.constant(base.initialText),
      textArb: bmpTextArb({ maxLength: 3 }),
    }),
  }),
);

describe("property: native snapshot suffix restore", () => {
  it("matches full replay after random local and remote suffixes", () => {
    // The default 1,000-run sweep completes near Vitest's 5s ceiling once V8
    // coverage instrumentation is enabled. Keep the property strength intact
    // and use an explicit backstop for slower coverage/CI execution.
    fc.assert(
      fc.property(snapshotSuffixArb, ({ base, localSuffix, remoteSuffix }) => {
        const baseTrace = runTrace(base);
        const remoteTrace = runTrace(remoteSuffix);
        fc.pre(baseTrace.appliedEdits + remoteTrace.appliedEdits > 0);

        const source = new EgWalkerReplica("snapshot-source", base.initialText);
        for (const event of baseTrace.events) {
          source.applyRemoteEvent(cloneEvent(event));
        }
        expect(source.getText()).toBe(baseTrace.canonicalText);

        const codec = new NativeSnapshotCodec();
        const restored = EgWalkerReplica.fromNativeSnapshot(
          codec.decode(codec.encode(source.createNativeSnapshot())),
          "snapshot-local",
        );
        expect(restored.getReplayStats().fullReplays).toBe(0);

        for (const edit of localSuffix) {
          applyLocalEdit(restored, edit);
        }
        for (const event of prefixEventIds(
          remoteTrace.events,
          "snapshot-remote",
        )) {
          restored.applyRemoteEvent(event);
        }
        expect(restored.getPendingRemoteCount()).toBe(0);

        const fullReplayGraph = EventGraph.fromEvents(
          restored.exportEventGraph().map(cloneEvent),
        );
        const fullReplay = new EgWalkerReplica(
          "snapshot-full-replay",
          base.initialText,
          fullReplayGraph,
        );

        expect(restored.getText()).toBe(fullReplay.getText());
      }),
      fcParams(),
    );
  }, 15_000);
});

const prefixEventIds = (
  events: ReadonlyArray<GraphEvent>,
  prefix: string,
): GraphEvent[] =>
  events.map((event) => ({
    ...cloneEvent(event),
    id: prefixedEventId(prefix, event.id),
    parentVersion: new Set(
      Array.from(event.parentVersion, (parent) =>
        prefixedEventId(prefix, parent),
      ),
    ),
  }));

const prefixedEventId = (prefix: string, id: EventId): EventId =>
  `${prefix}:${id}`;

const applyLocalEdit = (
  replica: EgWalkerReplica,
  edit: EditInstruction,
): void => {
  const text = replica.getText();
  if (edit.kind === "insert") {
    if (edit.text.length === 0) {
      return;
    }
    const rawIndex = Math.floor(edit.offsetSeed * (text.length + 1));
    replica.insert(snapPastSurrogate(text, rawIndex), edit.text);
    return;
  }
  if (text.length === 0) {
    return;
  }
  const rawStart = Math.floor(edit.offsetSeed * text.length);
  const start = snapPastSurrogate(text, Math.min(rawStart, text.length - 1));
  if (start >= text.length) {
    return;
  }
  const remaining = text.length - start;
  const rawLength = Math.max(1, Math.floor(edit.lengthSeed * remaining));
  const end = snapPastSurrogate(text, start + rawLength);
  const length = Math.min(end - start, remaining);
  if (length > 0) {
    replica.delete(start, length);
  }
};

const snapPastSurrogate = (text: string, index: number): number => {
  if (index <= 0 || index >= text.length) {
    return Math.max(0, Math.min(index, text.length));
  }
  const high = text.charCodeAt(index - 1);
  if (high < 0xd800 || high > 0xdbff) {
    return index;
  }
  const low = text.charCodeAt(index);
  return low >= 0xdc00 && low <= 0xdfff
    ? Math.min(index + 1, text.length)
    : index;
};
