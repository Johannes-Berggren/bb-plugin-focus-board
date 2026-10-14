// The ✨ auto-rename's pasted-file prompt recovery (server-side only: it
// reads bb's attachments store). A thread that opens with a composer paste
// carries a timeline user row with EMPTY text — the content lives in the
// stored attachment the row's `attachments.localFilePaths` names (found
// live on thr_eid3vv6gzt: "Pasted text.txt", 5991 bytes, and every ✨
// option failed "has no prompt text to title from" before any service or
// probe was called). bb's own layout is projectAttachmentDir =
// <bb.server.experimental_dataDir>/attachments/<projectId> with
// `stored_path` as the unique name under it — the recovery mirrors it.
//
// Fail-loud rules: a path that escapes the project's attachments dir
// (absolute, `..`, `~`) is refused with the path named, never read; a
// missing or binary file is an error naming the file, never a silent
// drop into the generic no-prompt failure.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWithinRoot } from "./workspace-paths";

/**
 * The absolute target of a stored attachment, or null when it escapes (the
 * caller fails loud with the path named — a null must become a refusal,
 * never a silent fall-through).
 */
export function attachmentPromptTarget(
  dataDir: string,
  projectId: string,
  storedPath: string,
): string | null {
  return resolveWithinRoot(join(dataDir, "attachments", projectId), storedPath);
}

/**
 * Read the pasted text an opener carried: at most 64KB (the built prompt
 * clamps at AUTOTITLE_PROMPT_MAX_CHARS long before this matters), utf8,
 * with NUL bytes treated as a binary-content marker — unusable for a
 * title. Returns the usable text, or an error object on the three refusal
 * shapes (escape, unreadable, unusable content). Throwing from the caller
 * path keeps the reason attached to the file the failure is about.
 */
export const AUTOTITLE_ATTACHMENT_READ_MAX_BYTES = 65_536;

export async function readAttachmentPromptText(
  target: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let raw: Buffer;
  try {
    const handle = await readFile(target);
    raw = handle.subarray(0, AUTOTITLE_ATTACHMENT_READ_MAX_BYTES);
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const text = raw.toString("utf8");
  if (text.includes("\u0000")) {
    return { ok: false, reason: "binary content (NUL bytes present)" };
  }
  const usable = text.trim();
  if (usable === "") {
    return { ok: false, reason: "file reads empty" };
  }
  return { ok: true, text: usable };
}