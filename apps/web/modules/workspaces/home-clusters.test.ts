import { describe, expect, it } from "vitest";
import type { DocsType } from "@/types/model";
import {
  CLUSTER,
  CLUSTER_LIMITS,
  EMPTY_LOCAL_HOME_STATE,
  homeClusters,
  recordOpened,
  togglePinned,
} from "@/modules/workspaces/home-clusters";

type DocumentRow = DocsType["Row"];

const document = (id: string, updated_at: string | null): DocumentRow => ({
  author_id: "author",
  created_at: "2026-01-01T00:00:00.000Z",
  created_by: null,
  id,
  is_public: false,
  slug: id,
  title: id,
  updated_at,
  updated_by: null,
  workspace_id: 1,
});

const documents = [
  document("a", "2026-01-03T00:00:00.000Z"),
  document("b", "2026-01-02T00:00:00.000Z"),
  document("c", "2026-01-01T00:00:00.000Z"),
];

const clusterNamed = (
  result: ReturnType<typeof homeClusters>,
  name: string,
) => {
  const cluster = result.find((entry) => entry.name === name);
  if (cluster === undefined) throw new Error(`No cluster ${name}`);
  return cluster;
};

describe("homeClusters", () => {
  it("puts every document in exactly one group", () => {
    const result = homeClusters({
      documents,
      local: { pinnedIds: ["c"], recentIds: ["b"] },
    });
    expect(
      clusterNamed(result, CLUSTER.Pinned).documents.map((d) => d.id),
    ).toEqual(["c"]);
    expect(
      clusterNamed(result, CLUSTER.Recent).documents.map((d) => d.id),
    ).toEqual(["b"]);
    expect(
      clusterNamed(result, CLUSTER.Everything).documents.map((d) => d.id),
    ).toEqual(["a"]);
  });

  it("lets a pin win over recency, because a pin is a decision", () => {
    const result = homeClusters({
      documents,
      local: { pinnedIds: ["b"], recentIds: ["b", "a"] },
    });
    expect(
      clusterNamed(result, CLUSTER.Pinned).documents.map((d) => d.id),
    ).toEqual(["b"]);
    expect(
      clusterNamed(result, CLUSTER.Recent).documents.map((d) => d.id),
    ).toEqual(["a"]);
  });

  it("drops local ids that no longer resolve to a document", () => {
    const result = homeClusters({
      documents,
      local: { pinnedIds: ["deleted"], recentIds: ["also-gone"] },
    });
    expect(clusterNamed(result, CLUSTER.Pinned).documents).toHaveLength(0);
    expect(clusterNamed(result, CLUSTER.Everything).documents).toHaveLength(3);
  });

  it("bounds each local cluster", () => {
    const many = Array.from({ length: 40 }, (_u, index) =>
      document(`d${index}`, "2026-01-01T00:00:00.000Z"),
    );
    const ids = many.map((entry) => entry.id);
    const result = homeClusters({
      documents: many,
      local: { pinnedIds: ids, recentIds: ids },
    });
    expect(clusterNamed(result, CLUSTER.Pinned).documents).toHaveLength(
      CLUSTER_LIMITS[CLUSTER.Pinned],
    );
    expect(clusterNamed(result, CLUSTER.Recent).documents).toHaveLength(
      CLUSTER_LIMITS[CLUSTER.Recent],
    );
  });

  it("orders the remainder by recency with a stable tiebreak", () => {
    const tied = [
      document("z", "2026-01-01T00:00:00.000Z"),
      document("a", "2026-01-01T00:00:00.000Z"),
      document("m", "2026-02-01T00:00:00.000Z"),
    ];
    const order = () =>
      clusterNamed(
        homeClusters({ documents: tied, local: EMPTY_LOCAL_HOME_STATE }),
        CLUSTER.Everything,
      ).documents.map((entry) => entry.id);
    expect(order()).toEqual(["m", "z", "a"]);
    // Same input in a different arrival order yields the same output.
    const reversed = clusterNamed(
      homeClusters({
        documents: [...tied].reverse(),
        local: EMPTY_LOCAL_HOME_STATE,
      }),
      CLUSTER.Everything,
    ).documents.map((entry) => entry.id);
    expect(reversed).toEqual(order());
  });

  it("sorts never-updated documents last", () => {
    const withNull = [document("new", null), ...documents];
    expect(
      clusterNamed(
        homeClusters({ documents: withNull, local: EMPTY_LOCAL_HOME_STATE }),
        CLUSTER.Everything,
      ).documents.at(-1)?.id,
    ).toBe("new");
  });

  it("explains every empty group rather than showing a blank", () => {
    for (const cluster of homeClusters({
      documents: [],
      local: EMPTY_LOCAL_HOME_STATE,
    })) {
      expect(cluster.documents).toHaveLength(0);
      expect(cluster.emptyHint.length).toBeGreaterThan(0);
    }
  });
});

describe("togglePinned", () => {
  it("pins, unpins, and keeps the newest decision first", () => {
    const one = togglePinned(EMPTY_LOCAL_HOME_STATE, "a");
    expect(one.pinnedIds).toEqual(["a"]);
    const two = togglePinned(one, "b");
    expect(two.pinnedIds).toEqual(["b", "a"]);
    expect(togglePinned(two, "b").pinnedIds).toEqual(["a"]);
  });

  it("never grows past the cluster limit", () => {
    let state = EMPTY_LOCAL_HOME_STATE;
    for (let index = 0; index < 40; index += 1) {
      state = togglePinned(state, `d${index}`);
    }
    expect(state.pinnedIds).toHaveLength(CLUSTER_LIMITS[CLUSTER.Pinned]);
  });
});

describe("recordOpened", () => {
  it("moves a document to the front without duplicating it", () => {
    const state = recordOpened(recordOpened(EMPTY_LOCAL_HOME_STATE, "a"), "b");
    expect(recordOpened(state, "a").recentIds).toEqual(["a", "b"]);
  });

  it("stays bounded", () => {
    let state = EMPTY_LOCAL_HOME_STATE;
    for (let index = 0; index < 100; index += 1) {
      state = recordOpened(state, `d${index}`);
    }
    expect(state.recentIds.length).toBeLessThanOrEqual(
      CLUSTER_LIMITS[CLUSTER.Recent] * 2,
    );
  });
});
