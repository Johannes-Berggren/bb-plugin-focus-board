// The ✨ auto-rename prompt recovery for pasted-file openers: a thread that
// opens with a pasted text attachment carries a timeline user row with empty
// text and attachments.localFilePaths (found live — thread thr_eid3vv6gzt
// opened with "Pasted text.txt", 5991 bytes, and every ✨ option failed with
// "has no prompt text to title from" before any service was called). These
// tests drive the real RPC through the fake host: the recovery rides the
// same prompt read both the service path and the thread-model probe use.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstUserPromptFileFromTimeline } from "../lib/autotitle-thread-model";
import { attachmentPromptTarget } from "../lib/autotitle-attachment";
import { setup } from "./helpers/autotitle-fake-host";

const ROW_WITH_PASTE = {
  kind: "conversation",
  role: "user",
  text: "",
  attachments: { localFilePaths: ["Pasted-text-htb894.txt"] },
  id: "r1",
};

async function withTempDataDir(projectId: string, contents: Record<string, string>) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "autotitle-attachments-"));
  await mkdir(path.join(dataDir, "attachments", projectId), { recursive: true });
  for (const [name, text] of Object.entries(contents)) {
    await writeFile(path.join(dataDir, "attachments", projectId, name), text);
  }
  return { dataDir, cleanup: () => rm(dataDir, { recursive: true, force: true }) };
}

describe("firstUserPromptFileFromTimeline", () => {
  it("returns the pasted-file path of the oldest empty-text user row", () => {
    expect(
      firstUserPromptFileFromTimeline([
        { kind: "conversation", role: "assistant", text: "later", id: "r2" },
        ROW_WITH_PASTE,
      ]),
    ).toBe("Pasted-text-htb894.txt");
  });

  it("ignores image attachments, non-user rows, and text rows", () => {
    expect(
      firstUserPromptFileFromTimeline([
        {
          kind: "conversation",
          role: "user",
          text: "",
          attachments: { localImagePaths: ["img.png"], localFilePaths: [] },
          id: "r1",
        },
        { kind: "conversation", role: "assistant", text: "", id: "r2" },
      ]),
    ).toBeNull();
  });

  it("skips empty rows to a later user row with a paste", () => {
    expect(
      firstUserPromptFileFromTimeline([
        { kind: "conversation", role: "user", text: "", id: "r0" },
        ROW_WITH_PASTE,
      ]),
    ).toBe("Pasted-text-htb894.txt");
  });

  it("returns null without any paste-bearing row", () => {
    expect(firstUserPromptFileFromTimeline([])).toBeNull();
  });
});

describe("attachmentPromptTarget", () => {
  it("resolves a stored paste name inside the project's attachments dir", () => {
    expect(
      attachmentPromptTarget("/data", "proj_1", "Pasted-text-htb894.txt"),
    ).toBe(path.join("/data", "attachments", "proj_1", "Pasted-text-htb894.txt"));
  });

  it("refuses path escapes and absolute paths (null, not a read)", () => {
    expect(
      attachmentPromptTarget("/data", "proj_1", "../other-project/file.txt"),
    ).toBeNull();
    expect(
      attachmentPromptTarget("/data", "proj_1", "/etc/passwd"),
    ).toBeNull();
  });
});

describe("thread_autotitle recovers a pasted-file opener", () => {
  it("titles from the pasted file's content through the selected service", async () => {
    const projectId = "proj_1";
    const { dataDir, cleanup } = await withTempDataDir(projectId, {
      "Pasted-text-htb894.txt": "Please fix the login redirect loop on /logout.",
    });
    try {
      const { callRpc, lastServiceCall } = await setup({
        dataDir,
        sourceTimeline: { rows: [ROW_WITH_PASTE] },
        history: [],
      });
      const out = (await callRpc("thread_autotitle", { threadId: "thr_x" })) as {
        title: string;
      };
      expect(out).toEqual({ title: "Login redirect loop fix" });
      const call = lastServiceCall();
      expect(call).not.toBeNull();
      expect(call!.input).toMatchObject({
        prompt: expect.stringContaining("login redirect loop on /logout"),
      });
    } finally {
      await cleanup();
    }
  });

  it("the thread-model probe path uses the recovered paste too", async () => {
    const projectId = "proj_1";
    const { dataDir, cleanup } = await withTempDataDir(projectId, {
      "Pasted-text-htb894.txt": "Fix the login redirect loop on /logout.",
    });
    try {
      const { callRpc, lastSpawn } = await setup({
        dataDir,
        sourceTimeline: { rows: [ROW_WITH_PASTE] },
        history: [],
      });
      await callRpc("thread_autotitle", { threadId: "thr_x", useThreadModel: true });
      const spawn = lastSpawn();
      // The probe spawns on the source thread's project and its prompt is
      // the recovered paste (the recovery feeds both ✨ paths the same way,
      // and this assertion is what makes the spawn itself the proof).
      expect((spawn as { projectId?: string } | null)?.projectId).toBe(projectId);
      expect((spawn as { prompt?: string } | null)?.prompt).toContain(
        "login redirect loop on /logout",
      );
    } finally {
      await cleanup();
    }
  });

  it("fails loud naming the paste when the stored file is missing", async () => {
    const { dataDir, cleanup } = await withTempDataDir("proj_1", {});
    try {
      const { callRpc } = await setup({
        dataDir,
        sourceTimeline: { rows: [ROW_WITH_PASTE] },
        history: [],
      });
      await expect(
        callRpc("thread_autotitle", { threadId: "thr_x" }),
      ).rejects.toThrow(/Pasted-text-htb894\.txt/);
    } finally {
      await cleanup();
    }
  });

  it("fails loud when the stored path escapes the attachments dir", async () => {
    const { callRpc } = await setup({
      dataDir: "/tmp/autotitle-attachments-no-write",
      sourceTimeline: {
        rows: [
          {
            ...ROW_WITH_PASTE,
            attachments: { localFilePaths: ["../../escaped.txt"] },
          },
        ],
      },
      history: [],
    });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x" }),
    ).rejects.toThrow(/escaped\.txt/);
  });

  it("keeps the generic no-prompt failure when no paste and no text exist", async () => {
    const { callRpc } = await setup({ history: [] });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x" }),
    ).rejects.toThrow(/no prompt/i);
  });
});