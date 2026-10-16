import { projectDisplayName } from "./project-name";

/**
 * The project + checkout facts a thread contributes to the thread pane's
 * composer-context fallback row. bb's own thread page shows this context
 * ("Project · environment · branch") in the compose area, but the embedded
 * `ThreadChat` the SDK hands plugin panels renders none of it on a narrow
 * pane (it never receives a compact summary), so the pane paints its own
 * line from these labels when the host's row is missing.
 */
export interface PaneContextInfo {
  projectId: string;
  /** `lib/project-name`'s board alignment: the composer picker's name, "No project" for personal. */
  projectLabel: string;
  /**
   * The environment's own name ("Worktree thr_…"), or "Project checkout"
   * for a plain checkout whose name is unknown. Null when the environment
   * carries nothing displayable and there is no branch either.
   */
  environmentLabel: string | null;
  /** The environment's branch; checked out detached/unknown when null. */
  branchLabel: string | null;
}

/**
 * Builds the pane's context facts from a sidebar thread row, or null when
 * the thread has no environment: bb itself shows no context row for those
 * threads on the page either, so the pane stays quiet rather than
 * inventing a "No project · nothing" line for them.
 */
export function paneContextInfo(
  thread: {
    projectId: string;
    environment?: {
      name: string | null;
      branchName: string | null;
      isWorktree: boolean | null;
    } | null;
  },
  {
    personalProjectId,
    projects,
  }: {
    personalProjectId?: string;
    projects: readonly { id: string; name: string }[];
  },
): PaneContextInfo | null {
  // The SDK contract types `environment` as `… | null`; absent reads the
  // same way ("nothing to describe") because the alternative for a missing
  // field is crashing the whole pane for the sake of one cosmetic line.
  const environment = thread.environment ?? null;
  if (environment === null) return null;
  // The host's own compact chip prefers the checkout label and falls back
  // to the environment's compact name; the pane fallback keeps that order
  // of importance.
  const environmentLabel =
    environment.name ?? (environment.isWorktree === false ? "Project checkout" : null);
  return {
    projectId: thread.projectId,
    projectLabel: projectDisplayName(thread.projectId, { personalProjectId, projects }),
    environmentLabel,
    branchLabel: environment.branchName,
  };
}