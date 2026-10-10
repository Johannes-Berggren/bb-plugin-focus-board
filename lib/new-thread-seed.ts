/**
 * Which project id the board's new-thread composer is seeded with.
 *
 * A child preset beats the board filter: the operator asked for a child of
 * a specific thread, so the child copies the parent's project — the family
 * keeps landing in one place — even when a single-project filter disagrees.
 * Without a parent preset the rungs descend through less-and-less-explicit
 * context, each behind a staleness guard:
 *
 * 2. the single-project filter — a filter id naming a project the loaded
 *    picker no longer knows seeds nothing (its original guard, unchanged);
 * 3. derived — the one project every non-archived thread the board currently
 *    shows belongs to (`newThreadDerivedProjectId`);
 * 4. remembered — the project the board's composer last successfully
 *    spawned into (`rememberedProjectStorageKey`, keyed by plugin id).
 *
 * Rungs 3 and 4 are rejected ONLY by a picker list that has demonstrably
 * loaded and lacks the id: a slow project query (or an error) treats the
 * list as unloaded, so memory is never wiped by absent data — the composer
 * re-seeds on prop change anyway, and a later-loaded list heals the pick.
 * Rungs 3 and 4 never seed bb's personal project ("No project",
 * `BB_PERSONAL_PROJECT_ID`, also excluded by sidebar `isPersonal`): seeding
 * personal on purpose is bb core's decision, tracked in
 * https://github.com/cristoslc/bb-plugin-focus-board/issues/25 — do not
 * repurpose these rungs to seed it.
 * An unresolvable parent (its row left the board while the dialog is open)
 * falls down the ladder the same way — the spawn still carries
 * `parentThreadId` (the preset is about the parent, not the project).
 */
export function newThreadSeedProjectId({
  parentProjectId,
  filterProjectId,
  derivedProjectId,
  rememberedProjectId,
  personalProjectId,
  knownProjectIds,
  knownProjectsLoaded,
}: {
  /** The preset parent's projectId; undefined when absent or unresolvable. */
  parentProjectId?: string;
  /** The single project id a board filter selected; undefined otherwise. */
  filterProjectId?: string;
  /** The board's unanimous project (`newThreadDerivedProjectId`); undefined when none. */
  derivedProjectId?: string;
  /** The remembered last-spawn project (`parseRememberedProjectStored`); undefined when none. */
  rememberedProjectId?: string;
  /** The sidebar-declared personal project id, when its list is known. */
  personalProjectId?: string;
  /** The project ids the composer's picker knows — the staleness guard. */
  knownProjectIds: readonly string[];
  /** Whether `knownProjectIds` has loaded; an unloaded list guards nothing. */
  knownProjectsLoaded: boolean;
}): string | undefined {
  if (parentProjectId !== undefined) return parentProjectId;
  if (filterProjectId !== undefined && knownProjectIds.includes(filterProjectId)) {
    return filterProjectId;
  }
  const personal = new Set<string>([BB_PERSONAL_PROJECT_ID]);
  if (personalProjectId !== undefined) personal.add(personalProjectId);
  for (const candidate of [derivedProjectId, rememberedProjectId]) {
    if (candidate === undefined || personal.has(candidate)) continue;
    if (knownProjectsLoaded && !knownProjectIds.includes(candidate)) continue;
    return candidate;
  }
  return undefined;
}

/** bb's personal project id, shown as "No project" in the picker. Never a
 *  seed from the derived or remembered rungs — that decision belongs to
 *  issue #25 (https://github.com/cristoslc/bb-plugin-focus-board/issues/25). */
export const BB_PERSONAL_PROJECT_ID = "proj_personal";

/**
 * The board's derived project: the one id every shown non-archived thread
 * belongs to, undefined when the board is empty or mixed (or when
 * `projectId` disagreements exist at all — unanimity is exact).
 */
export function newThreadDerivedProjectId(
  threadProjectIds: readonly string[],
): string | undefined {
  const [first, ...rest] = threadProjectIds;
  if (first === undefined) return undefined;
  return rest.every((projectId) => projectId === first) ? first : undefined;
}

/**
 * The remembered-project rung's localStorage persistence. The key is
 * plugin-scoped (the SDK's plugin-keying rule: key out-of-band state with
 * `experimental_usePluginId()`), so a renamed republish never collides with
 * the original. The parsing lives here — pure, unit-testable without a
 * DOM — so app.tsx only wires localStorage access around it.
 */

/** The value stored is the project id verbatim; blank means no memory. */
export function rememberedProjectStoredValue(projectId: string): string {
  return projectId;
}

/** A stored record parses as no memory when absent or blank; anything else
 *  is the project id verbatim. */
export function parseRememberedProjectStored(
  raw: string | null,
): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** The plugin-scoped localStorage key for the remembered project id. */
export function rememberedProjectStorageKey(pluginId: string): string {
  return `${pluginId}:rememberedNewThreadProjectId`;
}

/**
 * Which environment the board's new-thread composer is seeded with for a
 * child thread.
 *
 * A parent whose environment is a git worktree seeds the composer's
 * round-trippable `reuse` variant — the child starts in the parent's
 * checkout, not the project-default one. Everything else seeds nothing:
 * a plain checkout, a provider machine, or an unknown worktree kind
 * (`isWorktree: null`) cannot be expressed from a sidebar row without
 * guessing a host or provider, and the composer's own default for the
 * already-seeded project is the honest fallback. A stale `environmentId`
 * degrades the same way inside the composer (its documented fallback
 * resolves a default checkout when the reused worktree has no
 * unarchived threads).
 */
export function newThreadSeedEnvironment({
  parentEnvironment,
}: {
  /** The preset parent's environment record; undefined when absent. */
  parentEnvironment?:
    | { id: string | null; isWorktree: boolean | null }
    | null
    | undefined;
}): { type: "reuse"; environmentId: string } | undefined {
  if (
    parentEnvironment?.id != null &&
    parentEnvironment.isWorktree === true
  ) {
    return { type: "reuse", environmentId: parentEnvironment.id };
  }
  return undefined;
}