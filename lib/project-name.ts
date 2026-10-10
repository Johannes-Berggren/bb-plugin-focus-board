import { BB_PERSONAL_PROJECT_ID } from "./new-thread-seed";

/**
 * The board card's label for a thread's project, aligned with the composer's
 * picker (issue #25): bb's personal project — the id its New-thread picker
 * renders as "No project" (the projectless state) — is labeled "No project"
 * here too, instead of the personal row's server-initialized name
 * ("Personal", rename-able) the picker itself never shows. An id the sidebar
 * list does not know also renders "No project": bb core resolves a
 * requested-but-unresolvable project id to that same personal state, so the
 * two surfaces agree for real rows, personal threads, and vanished ids
 * alike. A declared row keeps its operator-visible name.
 */
export const NO_PROJECT_LABEL = "No project";

export function projectDisplayName(
  projectId: string,
  {
    personalProjectId,
    projects,
  }: {
    personalProjectId?: string;
    projects: readonly { id: string; name: string }[];
  },
): string {
  if (projectId === BB_PERSONAL_PROJECT_ID || projectId === personalProjectId) {
    return NO_PROJECT_LABEL;
  }
  return projects.find((project) => project.id === projectId)?.name ?? NO_PROJECT_LABEL;
}