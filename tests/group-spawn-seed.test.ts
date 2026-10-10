// The group-spawn seed: which project and which provider/model pair a
// "New thread in group…" composer is seeded with. The rule is the
// majority of the group's member threads, voted per member from the
// sidebar row (projectId, providerId) and the member's resolved
// execution options (model). The vote and its tie-breaks live here, pure,
// so tests pin them without rendering the app (the card-menu precedent).
import { describe, expect, it } from "vitest";
import { majorityGroupSpawnSeed } from "../lib/group-spawn-seed";

describe("majorityGroupSpawnSeed", () => {
  it("no votes seed nothing (the composer keeps its own defaults)", () => {
    expect(majorityGroupSpawnSeed([])).toEqual({});
  });

  it("members with nothing resolved cast no vote", () => {
    expect(
      majorityGroupSpawnSeed([
        { projectId: null, providerId: null, model: null },
        {},
        { projectId: undefined, providerId: undefined, model: undefined },
      ]),
    ).toEqual({});
  });

  it("a single member's settings carry the seed verbatim", () => {
    expect(
      majorityGroupSpawnSeed([
        { projectId: "proj_a", providerId: "pi_a", model: "m_a" },
      ]),
    ).toEqual({ projectId: "proj_a", providerId: "pi_a", model: "m_a" });
  });

  it("the most common project wins", () => {
    expect(
      majorityGroupSpawnSeed([
        { projectId: "proj_a" },
        { projectId: "proj_a" },
        { projectId: "proj_b" },
      ]),
    ).toEqual({ projectId: "proj_a" });
  });

  it("the most common provider/model PAIR wins, not each field's mode", () => {
    // All three pairs tie one vote each — a per-field majority would mint
    // (pi_b, m_x), a pair that no member ever ran. The pair vote keeps to
    // pairs the group actually held: first-seen.
    expect(
      majorityGroupSpawnSeed([
        { providerId: "pi_a", model: "m_x" },
        { providerId: "pi_b", model: "m_x" },
        { providerId: "pi_b", model: "m_y" },
      ]),
    ).toEqual({ providerId: "pi_a", model: "m_x" });
  });

  it("a partial vote (provider without model) cannot win the pair", () => {
    expect(
      majorityGroupSpawnSeed([
        { providerId: "pi_a", model: "m_a" },
        { providerId: "pi_a", model: "m_a" },
        { providerId: "pi_b", model: null },
      ]),
    ).toEqual({ providerId: "pi_a", model: "m_a" });
  });

  it("ties break to the first-seen member's vote (deterministic, no coercion)", () => {
    expect(
      majorityGroupSpawnSeed([
        { projectId: "proj_b" },
        { projectId: "proj_a" },
      ]),
    ).toEqual({ projectId: "proj_b" });
  });

  it("project and execution pair seed independently of each other", () => {
    expect(
      majorityGroupSpawnSeed([
        { projectId: "proj_a", providerId: "pi_a", model: "m_a" },
        { projectId: "proj_a", providerId: "pi_b", model: "m_b" },
        { projectId: "proj_b", providerId: "pi_a", model: "m_a" },
      ]),
    ).toEqual({ projectId: "proj_a", providerId: "pi_a", model: "m_a" });
  });
});