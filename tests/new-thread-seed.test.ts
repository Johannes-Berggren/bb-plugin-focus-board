// The composer's project seed precedence (lib/new-thread-seed): a child
// preset copies its PARENT'S project, even when a single-project board
// filter names something else; without a parent the filter seeds, then the
// board's unanimous project (derived), then the project the board's composer
// last spawned into (remembered), and stale project ids seed nothing —
// with nothing armed the modal hands the host composer no seed at all and
// bb lands on its personal project ("No project"); that default belongs to
// bb core (issue #25), never to these rungs.
import { describe, expect, it } from "vitest";
import {
  BB_PERSONAL_PROJECT_ID,
  newThreadSeedEnvironment,
  newThreadSeedProjectId,
  newThreadDerivedProjectId,
  parseRememberedProjectStored,
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
    // personal project). Remembering it must not re-seed "No project";
    // seeding personal is bb core's decision, tracked in issue #25.
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
    // and with no remembered rung the ladder hands over nothing at all.
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