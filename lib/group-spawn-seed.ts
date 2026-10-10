// The "New thread in group…" spawn seed: which project and which
// provider/model pair the board's composer is seeded with when the
// operator starts a thread from a group box's context menu.
//
// The rule is MAJORITY VOTE among the group's member threads. Each member
// casts one vote carrying:
// - `projectId` — the sidebar row already knows it (no fetch);
// - `providerId` + `model` — the provider comes from the row, the model
//   resolves per member through `sdk.threads.defaultExecutionOptions`
//   (the same resolved chain the server's autotitle probe clones a
//   spawn from).
//
// Two vote shapes, deliberately:
// - project votes alone — a project id is a free-standing fact;
// - provider and model vote as ONE PAIR — a model id only exists inside
//   its provider's catalog, so a per-field majority could mint a pair
//   no member ever ran. The pair mode keeps to pairs the group actually
//   held.
//
// A member that resolved nothing (a defaultExecutionOptions came back
// null, or a field was absent) casts no vote — an unresolvable member
// is data the composer's own fallback already handles, not an error.
// Ties break to the FIRST-SEEN vote in the caller's member order
// (deterministic, no coercion); ties on an empty set seed nothing, which
// leaves the composer's own defaults in charge.
//
// Pure module: no host, no SDK, no React.

/** One member's resolved settings — the vote it casts. Null/absent fields skip. */
export interface GroupSpawnSeedVote {
  projectId?: string | null;
  providerId?: string | null;
  model?: string | null;
}

/** The majority seed; a field absent when no member voted for it. */
export interface GroupSpawnSeed {
  projectId?: string;
  providerId?: string;
  model?: string;
}

/** Count-descending mode with a first-seen tie-break. */
function majorityOf(votes: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of votes) {
    if (value === undefined) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function majorityGroupSpawnSeed(
  votes: readonly GroupSpawnSeedVote[],
): GroupSpawnSeed {
  const projectVotes = votes.map((vote) => vote.projectId ?? undefined);
  // The execution pair: only COMPLETE votes count (provider and model
  // together), joined on \u0000 — no legitimate host id carries a NUL.
  const pairVotes: (string | undefined)[] = [];
  for (const vote of votes) {
    const providerId = vote.providerId ?? undefined;
    const model = vote.model ?? undefined;
    if (providerId === undefined || model === undefined) continue;
    pairVotes.push(`${providerId}\u0000${model}`);
  }
  let seed: GroupSpawnSeed = {};
  const project = majorityOf(projectVotes);
  if (project !== undefined) seed.projectId = project;
  const pair = majorityOf(pairVotes);
  if (pair !== undefined) {
    const [providerId, model] = pair.split("\u0000");
    if (providerId !== undefined) seed.providerId = providerId;
    if (model !== undefined) seed.model = model;
  }
  return seed;
}