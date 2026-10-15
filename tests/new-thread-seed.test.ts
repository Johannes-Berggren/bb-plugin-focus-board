// The composer's project seed precedence (lib/new-thread-seed): a child
// preset copies its PARENT'S project, even when a single-project board
// filter names something else; without a parent the filter seeds, then the
// board's unanimous project (derived), then the project the board's composer
// last spawned into (remembered), and stale project ids seed nothing —
// with nothing armed the modal hands the host composer no seed at all and
// bb lands on its personal project ("No project") by its own fallback; that
// fallback belongs to bb core (issue #25, get-bb/bb#5340), never to these
// rungs. The filter rung itself seeds the personal state deliberately when
// the operator filtered to it: a filter is explicit intent (#25, decision
// (a)), while the derived and remembered rungs never seed personal.
import { describe, expect, it } from "vitest";
import {
  BB_PERSONAL_PROJECT_ID,
  newThreadSeedEnvironment,
  newThreadSeedEnvironmentForProject,
  newThreadSeedProjectId,
  newThreadDerivedProjectId,
  parseRememberedEnvironmentStored,
  parseRememberedProjectStored,
  rememberedEnvironmentStorageKey,
  rememberedEnvironmentStoredValue,
  rememberedProjectStorageKey,
  rememberedProjectStoredValue,
} from "../lib/new-thread-seed";

const known = ["proj_home", "proj_side", "personal_default"];

const seedArgs = (extra: {
  parentProjectId?: string;
  filterProjectId?: string;
  derivedProjectId?: string;
  rememberedProjectId?: string;
  personalProjectId?: string;
  knownProjectIds?: readonly string[];
  knownProjectsLoaded?: boolean;
}) =>
  newThreadSeedProjectId({
    knownProjectIds: extra.knownProjectIds ?? known,
    knownProjectsLoaded: extra.knownProjectsLoaded ?? true,
    ...extra,
  });

describe("newThreadSeedProjectId", () => {
  it("a child copies the parent's project even against the filter", () => {
    const seed = seedArgs({
      parentProjectId: "proj_home",
      filterProjectId: "proj_side",
    });
    expect(seed).toBe("proj_home");
  });

  it("without a parent, the single filter-selected project seeds", () => {
    const seed = seedArgs({ filterProjectId: "proj_side" });
    expect(seed).toBe("proj_side");
  });

  it("a stale filter id seeds nothing (inverse)", () => {
    const seed = seedArgs({ filterProjectId: "proj_deleted" });
    expect(seed).toBeUndefined();
  });

  it("a remembered project seeds when nothing outranks it", () => {
    const seed = seedArgs({ rememberedProjectId: "proj_home" });
    expect(seed).toBe("proj_home");
  });

  it("a remembered id is guarded like any other: only a LOADED picker list may reject it", () => {
    // List loaded and the remembered id is a deleted project: it falls
    // through to the derived rung, then nothing.
    const staleRemembered = seedArgs({
      rememberedProjectId: "proj_deleted",
      derivedProjectId: "proj_side",
    });
    expect(staleRemembered).toBe("proj_side");
    const staleRememberedAndDerived = seedArgs({
      rememberedProjectId: "proj_deleted",
      derivedProjectId: "proj_gone",
    });
    expect(staleRememberedAndDerived).toBeUndefined();
  });

  it("an unloaded picker list never rejects a remembered id", () => {
    // A slow project query must not wipe the memory: with the list not
    // demonstrably loaded, the stored id seeds as-is.
    const seed = seedArgs({
      rememberedProjectId: "proj_home",
      knownProjectIds: [],
      knownProjectsLoaded: false,
    });
    expect(seed).toBe("proj_home");
  });

  it("a remembered id equal to the personal project seeds nothing", () => {
    // The operator's last board pick was "Don't work in a project" (bb's
    // personal project). Remembering it must not re-seed "No project":
    // only the operator's EXPLICIT act (the filter, #25 decision (a))
    // seeds the personal state; the remembered rung stays silent.
    const seededFromConstant = seedArgs({
      rememberedProjectId: BB_PERSONAL_PROJECT_ID,
    });
    expect(seededFromConstant).toBeUndefined();
    const seededFromSidebar = seedArgs({
      rememberedProjectId: "personal_default",
      personalProjectId: "personal_default",
    });
    expect(seededFromSidebar).toBeUndefined();
  });
});

describe("newThreadDerivedProjectId", () => {
  it("a unanimous board yields its single project", () => {
    expect(newThreadDerivedProjectId(["proj_a", "proj_a", "proj_a"])).toBe("proj_a");
  });

  it("a one-thread board yields that thread's project", () => {
    expect(newThreadDerivedProjectId(["proj_a"])).toBe("proj_a");
  });

  it("a mixed board yields nothing (inverse)", () => {
    expect(newThreadDerivedProjectId(["proj_a", "proj_b", "proj_a"])).toBeUndefined();
  });

  it("an empty board yields nothing (inverse)", () => {
    expect(newThreadDerivedProjectId([])).toBeUndefined();
  });
});

describe("derived rung (through the ladder)", () => {
  it("a unanimous board seeds its project with empty memory (cold start)", () => {
    // The board's normal state after the fix: every shown thread lands in
    // one project, nothing remembered yet — the derive rung seeds.
    const seed = seedArgs({ derivedProjectId: "proj_home" });
    expect(seed).toBe("proj_home");
  });

  it("a derived id is staleness-guarded against the loaded picker list", () => {
    const staleDerived = seedArgs({ derivedProjectId: "proj_deleted" });
    expect(staleDerived).toBeUndefined();
    // An unloaded list cannot reject: the derive rung seeds as-is and the
    // composer re-seeds when the list heals.
    const unloaded = seedArgs({
      derivedProjectId: "proj_home",
      knownProjectIds: [],
      knownProjectsLoaded: false,
    });
    expect(unloaded).toBe("proj_home");
  });

  it("a unanimous personal board seeds nothing", () => {
    const seed = seedArgs({
      derivedProjectId: BB_PERSONAL_PROJECT_ID,
      rememberedProjectId: "proj_home",
    });
    // The personal derive would win on precedence alone; the exclusion
    // drops the rung entirely so the remembered project takes over —
    // and with no remembered rung the ladder hands over nothing at all
    // (bb's unseeded default owns that case; #25).
    const rememberedless = seedArgs({ derivedProjectId: BB_PERSONAL_PROJECT_ID });
    expect(rememberedless).toBeUndefined();
    expect(seed).toBe("proj_home");
  });

  it("the filter beats the derived rung", () => {
    const seed = seedArgs({
      filterProjectId: "proj_side",
      derivedProjectId: "proj_home",
    });
    expect(seed).toBe("proj_side");
  });

  it("the parent beats the derived rung", () => {
    const seed = seedArgs({
      parentProjectId: "proj_home",
      derivedProjectId: "proj_side",
    });
    expect(seed).toBe("proj_home");
  });

  it("the derived rung beats the remembered rung", () => {
    const seed = seedArgs({
      derivedProjectId: "proj_home",
      rememberedProjectId: "proj_side",
    });
    expect(seed).toBe("proj_home");
  });

  it("the filter beats the remembered rung", () => {
    const seed = seedArgs({
      filterProjectId: "proj_side",
      rememberedProjectId: "proj_home",
    });
    expect(seed).toBe("proj_side");
  });
});

describe("filter rung names the personal project deliberately (#25, decision (a))", () => {
  it("a filter naming bb's personal id seeds the personal pick though the picker list lacks it", () => {
    // bb 0.46.0's sidebar live view includes the personal row, so the normal
    // membership guard already passes — but a bb build whose list excludes
    // the row must not silence an explicit operator filter either: the
    // filter names the state, and the composer renders this id as "No
    // project" (its projectless pick). Deliberate seeding, not a fallback.
    const seed = seedArgs({
      filterProjectId: BB_PERSONAL_PROJECT_ID,
      knownProjectIds: ["proj_home"],
    });
    expect(seed).toBe(BB_PERSONAL_PROJECT_ID);
  });

  it("a filter naming the sidebar-declared personal id seeds it though the picker list lacks it", () => {
    const seed = seedArgs({
      filterProjectId: "personal_default",
      personalProjectId: "personal_default",
      knownProjectIds: ["proj_home"],
    });
    expect(seed).toBe("personal_default");
  });

  it("a parent preset still beats a personal filter", () => {
    const seed = seedArgs({
      parentProjectId: "proj_home",
      filterProjectId: BB_PERSONAL_PROJECT_ID,
    });
    expect(seed).toBe("proj_home");
  });

  it("a personal filter beats the derived and remembered rungs", () => {
    const seed = seedArgs({
      filterProjectId: BB_PERSONAL_PROJECT_ID,
      derivedProjectId: "proj_home",
      rememberedProjectId: "proj_side",
    });
    expect(seed).toBe(BB_PERSONAL_PROJECT_ID);
  });
});

describe("remembered-project storage (lib helpers)", () => {
  it("the storage key is plugin-scoped", () => {
    expect(rememberedProjectStorageKey("focus-board")).toBe(
      "focus-board:rememberedNewThreadProjectId",
    );
  });

  it("the stored value round-trips", () => {
    expect(parseRememberedProjectStored(rememberedProjectStoredValue("proj_home"))).toBe("proj_home");
  });

  it("an absent or blank record parses as no memory (inverse)", () => {
    expect(parseRememberedProjectStored(null)).toBeUndefined();
    expect(parseRememberedProjectStored("")).toBeUndefined();
    expect(parseRememberedProjectStored("   ")).toBeUndefined();
  });
});

describe("newThreadSeedEnvironment", () => {
  it("a worktree parent seeds a reuse environment", () => {
    // `reuse` is the composer's round-trippable "use this worktree as-is"
    // variant: the child starts in the parent's checkout, not a fresh
    // project-default one.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_1", isWorktree: true },
    });
    expect(seed).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("a non-worktree parent seeds nothing (inverse)", () => {
    // A plain checkout or provider machine cannot be expressed from a
    // sidebar row (no host or provider inputs); the composer's own default
    // for the already-seeded project is the honest fallback.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_2", isWorktree: false },
    });
    expect(seed).toBeUndefined();
  });

  it("an unknown worktree kind seeds nothing", () => {
    // isWorktree null: bb cannot say what the checkout is. A `reuse` guess
    // could point at a personal machine; no seed is the safe pick.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_3", isWorktree: null },
    });
    expect(seed).toBeUndefined();
  });

  it("a parent with no environment seeds nothing", () => {
    expect(
      newThreadSeedEnvironment({ parentEnvironment: undefined }),
    ).toBeUndefined();
  });
});

// The remembered-environment rung: per-project (a `reuse` memory is bound to
// one project's worktree — seeding it under another project would land the
// thread in a worktree the operator did not pick), written on spawn success,
// and beaten by the parent preset. A "(new) worktree" pick submits the
// project-agnostic `managed-worktree` variant, whose `baseBranch` resolves
// against the picked project at spawn time, so the memory travels across
// projects of its own accord; the per-project keying still guards `reuse`.
describe("remembered-environment storage (lib helpers)", () => {
  const NEW_WORKTREE = {
    type: "host",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  } as const;

  it("the storage key is plugin-scoped", () => {
    expect(rememberedEnvironmentStorageKey("focus-board")).toBe(
      "focus-board:rememberedNewThreadEnvironments",
    );
  });

  it("the stored map round-trips per project", () => {
    const stored = rememberedEnvironmentStoredValue({
      proj_home: NEW_WORKTREE,
      proj_side: { type: "reuse", environmentId: "env_1" },
    });
    expect(parseRememberedEnvironmentStored(stored)).toEqual({
      proj_home: NEW_WORKTREE,
      proj_side: { type: "reuse", environmentId: "env_1" },
    });
  });

  it("an absent, blank, or malformed record parses as no memory", () => {
    expect(parseRememberedEnvironmentStored(null)).toBeUndefined();
    expect(parseRememberedEnvironmentStored("")).toBeUndefined();
    expect(parseRememberedEnvironmentStored("   ")).toBeUndefined();
    expect(parseRememberedEnvironmentStored("{not json")).toBeUndefined();
    expect(parseRememberedEnvironmentStored('["not","a","map"]')).toBeUndefined();
    expect(parseRememberedEnvironmentStored('"plain"')).toBeUndefined();
  });

  it("malformed entries drop while well-formed entries keep (mixed map)", () => {
    // localStorage is a host cache artifact: the board must not break on a
    // record it cannot validate. Malformed entries read as no memory for
    // their project; well-formed entries survive in the same map.
    const stored = rememberedEnvironmentStoredValue({
      proj_home: NEW_WORKTREE,
      proj_bad: "not an environment" as never,
    });
    expect(parseRememberedEnvironmentStored(stored)).toEqual({
      proj_home: NEW_WORKTREE,
    });
  });

  it("unknown environment types are dropped", () => {
    const stored = rememberedEnvironmentStoredValue({
      proj_bad: { type: "teleport" } as never,
      proj_reuse: { type: "reuse", environmentId: "env_1" },
    });
    expect(parseRememberedEnvironmentStored(stored)).toEqual({
      proj_reuse: { type: "reuse", environmentId: "env_1" },
    });
  });

  it("a reuse entry without an environmentId is dropped", () => {
    const stored = rememberedEnvironmentStoredValue({
      proj_bad: { type: "reuse", environmentId: 42 } as never,
    });
    expect(parseRememberedEnvironmentStored(stored)).toBeUndefined();
  });
});

describe("newThreadSeedEnvironmentForProject", () => {
  const NEW_WORKTREE = {
    type: "host",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  } as const;
  const parentEnvironment = { id: "env_parent", isWorktree: true } as const;

  it("a remembered (new) worktree pick seeds the managed-worktree variant", () => {
    // The shape "(new) worktree" submits and the composer's documented
    // round-trippable seed: the next plain New thread opens pre-picked.
    const seed = newThreadSeedEnvironmentForProject({
      rememberedEnvironment: NEW_WORKTREE,
    });
    expect(seed).toEqual(NEW_WORKTREE);
  });

  it("a remembered reuse pick seeds the reuse seed", () => {
    const seed = newThreadSeedEnvironmentForProject({
      rememberedEnvironment: { type: "reuse", environmentId: "env_1" },
    });
    expect(seed).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("a remembered project-default pick seeds nothing (inverse)", () => {
    // "Project checkout" is the composer's own unseeded default; a memory
    // of it must not turn into a seed (the SDK's `project-default` variant
    // seeds nothing by contract). Silence keeps the composer default in
    // charge exactly as before the memory existed.
    const seed = newThreadSeedEnvironmentForProject({
      rememberedEnvironment: { type: "project-default" },
    });
    expect(seed).toBeUndefined();
  });

  it("a no-project memory seeds nothing (inverse)", () => {
    // The memory is a companion to the picked project, never a standalone
    // pick: with no project resolved the rung stays silent.
    expect(newThreadSeedEnvironmentForProject({})).toBeUndefined();
  });

  it("the parent preset beats the remembered rung", () => {
    const seed = newThreadSeedEnvironmentForProject({
      parentEnvironment,
      rememberedEnvironment: NEW_WORKTREE,
    });
    expect(seed).toEqual({ type: "reuse", environmentId: "env_parent" });
  });

  it("a non-worktree parent falls through to the remembered rung", () => {
    // The parent preset is about copying the parent's checkout WHEN one can
    // be expressed; a plain-checkout parent says nothing about environments,
    // so the remembered rung still seeds for the (parent-copied) project.
    const seed = newThreadSeedEnvironmentForProject({
      parentEnvironment: { id: "env_plain", isWorktree: false },
      rememberedEnvironment: NEW_WORKTREE,
    });
    expect(seed).toEqual(NEW_WORKTREE);
  });

  it("an unknown-worktree-kind parent falls through to the remembered rung", () => {
    const seed = newThreadSeedEnvironmentForProject({
      parentEnvironment: { id: "env_unknown", isWorktree: null },
      rememberedEnvironment: { type: "reuse", environmentId: "env_1" },
    });
    expect(seed).toEqual({ type: "reuse", environmentId: "env_1" });
  });
});