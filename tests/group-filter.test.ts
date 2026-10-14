// Group filter: FilterState gains an optional `groups` restrict set (the
// board shows only threads whose feature-group bucket is selected; the
// "none" sentinel is the "No group" bucket for unassigned threads). The
// shared per-thread predicate runs under every filter entry point; a group
// miss drops even a dim-kept family member outright, mirroring the project
// column-gate policy. The Group view's hide gesture reuses the lane-hide
// helper over the same restrict set. Persistence mirrors the other filters
// (garbage ids simply restrict to nothing; the menu or Clear recovers).
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  NO_GROUP_BUCKET,
  filterBucketsWithoutLane,
  filterThreads,
  groupBucketFor,
  groupFilterMisses,
} from "../components/grouping";
import { buildFamilyIndex, filterFamilies, filterIndividually } from "../components/nesting";
import { thread } from "./thread-fixture";

// A registry-missing assignment ("Unknown group" bucket) keeps its real id.
const assignments = new Map<string, string>([
  ["thr_alpha", "grp_a"],
  ["thr_beta", "grp_b"],
  ["thr_unknown", "grp_orphan"],
]);

const alpha = thread({ id: "thr_alpha" });
const beta = thread({ id: "thr_beta" });
const unassigned = thread({ id: "thr_free" });
const orphan = thread({ id: "thr_unknown" });
const threads: PluginSidebarThread[] = [alpha, beta, unassigned, orphan];

const empty = (): ReadonlySet<string> => new Set();
const filter = (base: { projects?: ReadonlySet<string>; groups?: ReadonlySet<string> }) => ({
  projects: base.projects ?? empty(),
  providers: empty(),
  states: new Set(),
  groups: base.groups ?? empty(),
});

const ids = (result: readonly PluginSidebarThread[]) => result.map((t) => t.id).sort();

describe("groupBucketFor", () => {
  it("returns the assignment, or the No-group sentinel", () => {
    expect(groupBucketFor(alpha, assignments)).toBe("grp_a");
    expect(groupBucketFor(unassigned, assignments)).toBe(NO_GROUP_BUCKET);
    expect(groupBucketFor(unassigned, undefined)).toBe(NO_GROUP_BUCKET);
  });
});

describe("groupFilterMisses", () => {
  it("restricts to the selected buckets; the sentinel covers unassigned threads", () => {
    expect(groupFilterMisses(alpha, filter({ groups: new Set(["grp_a"]) }), assignments)).toBe(false);
    expect(groupFilterMisses(beta, filter({ groups: new Set(["grp_a"]) }), assignments)).toBe(true);
    expect(
      groupFilterMisses(unassigned, filter({ groups: new Set([NO_GROUP_BUCKET, "grp_a"]) }), assignments),
    ).toBe(false);
    expect(groupFilterMisses(unassigned, filter({ groups: new Set(["grp_a"]) }), assignments)).toBe(true);
  });

  it("an empty or absent set never misses (legacy stored filters)", () => {
    for (const t of threads) {
      expect(
        groupFilterMisses(t, { projects: empty(), providers: empty(), states: new Set() }, assignments),
      ).toBe(false);
    }
  });
});

describe("filterThreads with the group filter", () => {
  it("restricts to the No-group bucket for unassigned threads", () => {
    const result = filterThreads(threads, filter({ groups: new Set([NO_GROUP_BUCKET]) }), assignments);
    expect(ids(result)).toEqual(["thr_free"]);
  });

  it("composes with the project filter", () => {
    // alpha and beta share proj_a; the free thread sits elsewhere.
    const scoped: PluginSidebarThread[] = [
      alpha,
      beta,
      thread({ id: "thr_free", projectId: "proj_b" }),
    ];
    const result = filterThreads(
      scoped,
      filter({ groups: new Set(["grp_a", NO_GROUP_BUCKET]), projects: new Set(["proj_b"]) }),
      assignments,
    );
    expect(ids(result)).toEqual(["thr_free"]);
  });

  it("garbage persisted ids restrict to nothing without crashing", () => {
    const result = filterThreads(threads, filter({ groups: new Set(["grp_ghost"]) }), assignments);
    expect(result).toHaveLength(0);
  });
});

describe("filterIndividually with the group filter", () => {
  it("restricts per thread", () => {
    const kept = filterIndividually(threads, filter({ groups: new Set(["grp_b"]) }), "", undefined, undefined, undefined, assignments);
    expect(ids(kept.kept)).toEqual(["thr_beta"]);
  });
});

describe("filterFamilies with the group filter", () => {
  const parent = thread({ id: "thr_parent", status: "active" });
  const child = thread({ id: "thr_child" });
  const familyIndex = buildFamilyIndex([parent, child]);
  const familyAssignments = new Map<string, string>([
    ...assignments,
    ["thr_parent", "grp_b"],
    ["thr_child", "grp_b"],
  ]);

  it("a group-restrict miss drops a dim-kept member outright (column-gate policy)", () => {
    // The family matches on search state (parent working, child idle miss) —
    // but the restrict selects only grp_a, so the grp_b family drops whole.
    const result = filterFamilies(
      [parent, child],
      familyIndex,
      {
        projects: empty(),
        providers: empty(),
        states: new Set(["unread"]),
        groups: new Set(["grp_a"]),
      },
      "",
      undefined,
      undefined,
      undefined,
      familyAssignments,
    );
    expect(result.kept).toHaveLength(0);
  });

  it("a family with a passing member keeps, the restrict-missed parent dropped", () => {
    const mixedAssignments = new Map<string, string>([
      ["thr_parent", "grp_b"],
      ["thr_child", "grp_a"],
    ]);
    const result = filterFamilies(
      [parent, child],
      familyIndex,
      filter({ groups: new Set(["grp_a"]) }),
      "",
      undefined,
      undefined,
      undefined,
      mixedAssignments,
    );
    expect(ids(result.kept)).toEqual(["thr_child"]);
  });
});

describe("family keep flows whole: the one-pass spec (Defect 1 regression)", () => {
  // The decided rule: filtering is ONE keep pass (the family keep rule).
  // The retired group-box pass re-gated its already-kept input and dropped
  // dimmed family members whenever a frame existed anywhere — a parent's
  // card and its projection twin vanished, stranded children re-rooted as
  // lone cards, and the "dimmed inside its passing box" comment described
  // an unreachable state.
  const parent = thread({ id: "thr_p", displayTitle: "Patient provider" });
  const child = thread({ id: "thr_c", displayTitle: "child of patient", parentThreadId: "thr_p" });
  const frameMate = thread({ id: "thr_q", displayTitle: "Other frame member" });
  const index = buildFamilyIndex([parent, child, frameMate]);
  // The one-pass chain: the family filter's output IS the kept set. There
  // is no second pass to assert through; a frame cannot re-gate this
  // output anywhere in the app (structural: the re-gating pass is gone).
  const chain = (query: string) => filterFamilies([parent, child, frameMate], index, filter({}), query);

  it("a non-matching member of a passing family dims in place (search on the parent)", () => {
    const result = chain("provider");
    expect(ids(result.kept)).toEqual(["thr_c", "thr_p"]);
    expect([...result.dimmedIds]).toEqual(["thr_c"]);
  });

  it("the parent dims when only the child matches, and never drops", () => {
    const result = chain("child");
    expect(ids(result.kept)).toEqual(["thr_c", "thr_p"]);
    expect([...result.dimmedIds]).toEqual(["thr_p"]);
  });
});

describe("filterBucketsWithoutLane (the Group view's hide gesture)", () => {
  it("an empty selection materializes every other known bucket, this one out", () => {
    const next = filterBucketsWithoutLane(empty(), ["grp_a", "grp_b", NO_GROUP_BUCKET], "grp_b");
    expect(next).toEqual({ kind: "hidden", next: new Set(["grp_a", NO_GROUP_BUCKET]) });
  });

  it("a multi-selection just drops the bucket", () => {
    const next = filterBucketsWithoutLane(new Set(["grp_a", "grp_b"]), ["grp_a", "grp_b", "grp_c"], "grp_b");
    expect(next).toEqual({ kind: "hidden", next: new Set(["grp_a"]) });
  });

  it("the lane's bucket being the sole selection materializes the others", () => {
    const next = filterBucketsWithoutLane(new Set(["grp_b"]), ["grp_a", "grp_b"], "grp_b");
    expect(next).toEqual({ kind: "hidden", next: new Set(["grp_a"]) });
  });

  it("hiding the last known bucket refuses (sole-lane)", () => {
    expect(filterBucketsWithoutLane(empty(), ["grp_b"], "grp_b")).toEqual({
      kind: "refused",
      reason: "sole-lane",
    });
    expect(filterBucketsWithoutLane(new Set(["grp_b"]), ["grp_b"], "grp_b")).toEqual({
      kind: "refused",
      reason: "sole-lane",
    });
  });

  it("a bucket outside a non-empty selection cannot be hidden (outside-filter)", () => {
    expect(filterBucketsWithoutLane(new Set(["grp_a"]), ["grp_a", "grp_b"], "grp_b")).toEqual({
      kind: "refused",
      reason: "outside-filter",
    });
  });

  it("the No-group sentinel hides and restores like any bucket", () => {
    const next = filterBucketsWithoutLane(empty(), ["grp_a", NO_GROUP_BUCKET], NO_GROUP_BUCKET);
    expect(next).toEqual({ kind: "hidden", next: new Set(["grp_a"]) });
  });
});