import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  T3DesktopCache,
  threadsFromT3Shell,
} from "../src/lib/t3-desktop-cache.js";
import {
  batch,
  idbKey,
  log,
  manifest,
  shellMetadata,
  stringValue,
  table,
  vint,
  wideString,
} from "./helpers/leveldb-fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const thread = {
  id: "task",
  projectId: "p",
  title: "Running remotely",
  updatedAt: "2026-10-07T12:00:00Z",
  session: { status: "running" },
  latestTurn: { state: "running" },
};
const shell = {
  projects: [{ id: "p", workspaceRoot: "/project" }],
  threads: [thread],
};
function document(snapshot: unknown = shell) {
  return JSON.stringify({
    schemaVersion: 1,
    environmentId: "remote",
    snapshot,
  });
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chatgato-t3-cache-"));
  directories.push(root);
  const dir = join(root, "t3code_app_0.indexeddb.leveldb");
  await mkdir(dir);
  await writeFile(join(dir, "CURRENT"), "MANIFEST-000001\n");
  await writeFile(join(dir, "MANIFEST-000001"), manifest([2]));
  return { root, dir };
}

it("reads the latest shell from the live cache without interpreting other stores", async () => {
  vi.useFakeTimers();
  const { dir } = await fixture();
  await writeFile(
    join(dir, "000002.ldb"),
    table(1, [
      ...shellMetadata,
      [idbKey(2, "remote"), stringValue(document())],
      [idbKey(1, "document"), Buffer.from("not-a-shell-secret")],
    ]),
  );
  const cache = new T3DesktopCache([join(dir, "missing"), dir]);
  expect(await cache.read("remote")).toEqual([
    expect.objectContaining({
      id: "task",
      status: "working",
      cwd: "/project",
      t3ThreadRef: { threadId: "task", environmentId: "remote" },
    }),
  ]);
  await writeFile(
    join(dir, "000003.log"),
    log([
      batch(50, [
        [
          idbKey(2, "remote"),
          stringValue(
            document({
              ...shell,
              threads: [
                {
                  ...thread,
                  title: "Fini 🐈",
                  session: { status: "ready" },
                  latestTurn: { state: "completed" },
                },
              ],
            }),
            true,
          ),
        ],
      ]),
    ]),
  );
  vi.advanceTimersByTime(1001);
  expect(await cache.read("remote")).toEqual([
    expect.objectContaining({ title: "Fini 🐈", status: "unread" }),
  ]);
  await writeFile(
    join(dir, "000003.log"),
    log([batch(60, [[idbKey(2, "remote"), null]])]),
  );
  vi.advanceTimersByTime(1001);
  await expect(cache.read("remote")).rejects.toThrow("not synchronized");
});

it("reads large shell strings stored in external blobs", async () => {
  const { root, dir } = await fixture();
  const blobDir = join(root, "t3code_app_0.indexeddb.blob", "1", "01");
  await mkdir(blobDir, { recursive: true });
  // The blob stores the SSV, without IndexedDB's leading record version.
  const raw = stringValue(document()).subarray(1);
  await writeFile(join(blobDir, "181"), raw);
  const wrapper = Buffer.concat([
    vint(1),
    Buffer.from([255, 17, 1]),
    vint(raw.length),
    vint(0),
  ]);
  const external = Buffer.concat([
    Buffer.from([0]),
    vint(0x181),
    wideString("application/vnd.blink-idb-value-wrapper"),
    vint(raw.length),
  ]);
  await writeFile(
    join(dir, "000002.ldb"),
    table(1, [
      ...shellMetadata,
      [idbKey(2, "remote"), wrapper],
      [idbKey(2, "remote", 3), external],
    ]),
  );
  expect(await new T3DesktopCache([dir]).read("remote")).toEqual([
    expect.objectContaining({ status: "working" }),
  ]);
});

it("maps remote waits, failures, background work, completion, and worktree filters", () => {
  const threads = [
    { ...thread, id: "approval", hasPendingApprovals: true },
    { ...thread, id: "input", hasPendingUserInput: true },
    {
      ...thread,
      id: "failed",
      session: { status: "error" },
      latestTurn: { state: "failed" },
    },
    {
      ...thread,
      id: "background",
      session: { status: "ready" },
      latestTurn: { state: "completed" },
      backgroundLiveness: "monitoring",
    },
    {
      ...thread,
      id: "plan",
      session: { status: "ready" },
      latestTurn: { state: "completed" },
      hasActionableProposedPlan: true,
    },
    { ...thread, id: "idle", session: null, latestTurn: null },
    { ...thread, id: "archived", archivedAt: "2026-10-07" },
    {
      ...thread,
      id: "subagent",
      lineage: { relationshipToParent: "subagent" },
    },
    { ...thread, id: "worktree", worktreePath: "/worktree" },
  ];
  expect(
    Object.fromEntries(
      threadsFromT3Shell({ ...shell, threads }, "remote").map((t) => [
        t.id,
        t.status,
      ]),
    ),
  ).toEqual({
    approval: "awaiting-approval",
    input: "awaiting-response",
    failed: "error",
    background: "working",
    plan: "awaiting-response",
    idle: "idle",
    worktree: "working",
  });
  expect(threadsFromT3Shell({ ...shell, threads }, "remote", "/proj")).toEqual(
    [],
  );
  expect(
    threadsFromT3Shell({ ...shell, threads }, "remote", "/worktree").map(
      (t) => t.id,
    ),
  ).toEqual(["worktree"]);
  expect(
    threadsFromT3Shell(
      {
        projects: [{ id: "p", workspaceRoot: "C:\\project" }],
        threads: [thread],
      },
      "remote",
      "C:\\project",
    ),
  ).toHaveLength(1);
});
