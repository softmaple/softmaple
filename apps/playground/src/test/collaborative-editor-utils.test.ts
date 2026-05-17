import { EgWalkerReplica } from "@softmaple/eg-walker";
import { describe, expect, it } from "vitest";
import { computeLocalEdit } from "../modules/collaborative-editor/use-collaborative-editor";

const applyLocalEditToReplicaPair = (
  localReplica: EgWalkerReplica,
  remoteReplica: EgWalkerReplica,
  newText: string,
): void => {
  const edit = computeLocalEdit(localReplica.getText(), newText);

  if (!edit) {
    return;
  }

  edit.apply(localReplica);
  const events = localReplica.exportEventGraph();
  const newEvents = events.slice(-edit.mappingOperations.length);
  for (const event of newEvents) {
    remoteReplica.applyRemoteEvent(event);
  }
};

describe("collaborative editor utilities", () => {
  it("syncs pure insertions between actual replicas", () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");

    applyLocalEditToReplicaPair(localReplica, remoteReplica, "Hello");

    expect(localReplica.getText()).toBe("Hello");
    expect(remoteReplica.getText()).toBe("Hello");
  });

  it("syncs replacements with net length changes between actual replicas", () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");

    applyLocalEditToReplicaPair(localReplica, remoteReplica, "abcXYZdef");
    applyLocalEditToReplicaPair(localReplica, remoteReplica, "abc12345def");

    expect(localReplica.getText()).toBe("abc12345def");
    expect(remoteReplica.getText()).toBe("abc12345def");
  });
});
