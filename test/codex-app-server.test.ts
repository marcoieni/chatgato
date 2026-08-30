import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  usageFromAppServerResult,
} from "../src/lib/codex-app-server.js";
import { remainingPercent } from "../src/lib/codex-usage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function fakeAppServer(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chatgato-usage-server-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "fake-codex.mjs");
  await writeFile(executable, `#!/usr/bin/env node\n${source}`);
  await chmod(executable, 0o755);
  return executable;
}

describe("Codex app-server usage", () => {
  it("shares one connection across config, models, threads, usage, and notifications", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-shared-server-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "started.txt");
    const executable = await fakeAppServer(`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
appendFileSync(${JSON.stringify(marker)}, "started\\n");
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "config/read") {
    send({ method: "account/rateLimits/updated", params: { rateLimits: {} } });
    send({ id: message.id, result: { config: { service_tier: "fast" } } });
  }
  if (message.method === "model/list") send({ id: message.id, result: {
    data: [{ id: "gpt-test", supportedReasoningEfforts: [
      { reasoningEffort: "low" }, { reasoningEffort: "high" }
    ] }], nextCursor: null
  } });
  if (message.method === "thread/list") send({ id: message.id, result: {
    data: [
      { id: "root", cwd: "/tmp/project", path: "/tmp/root.jsonl", preview: "Root chat",
        parentThreadId: null, updatedAt: 20, recencyAt: 21, status: { type: "notLoaded" } },
      { id: "child", cwd: "/tmp/project", path: "/tmp/child.jsonl", preview: "Child chat",
        parentThreadId: "root", updatedAt: 19, recencyAt: 19, status: { type: "notLoaded" } }
    ], nextCursor: null
  } });
  if (message.method === "thread/turns/list") send({ id: message.id, result: {
    data: [{ status: message.params.threadId === "root" ? "completed" : "inProgress",
      items: [], startedAt: 18, completedAt: message.params.threadId === "root" ? 20 : null }],
    nextCursor: null
  } });
  if (message.method === "account/rateLimits/read") send({ id: message.id, result: {
    rateLimits: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 300 } }
  } });
});
`);
    const client = new CodexAppServerClient({ executable });
    const notifications: string[] = [];
    const unsubscribe = client.subscribe((event) =>
      notifications.push(event.method),
    );

    await expect(client.readConfig()).resolves.toMatchObject({
      service_tier: "fast",
    });
    await expect(client.readModels()).resolves.toEqual([
      { id: "gpt-test", reasoningEfforts: ["low", "high"] },
    ]);
    await expect(client.readThreads()).resolves.toMatchObject([
      { id: "root", status: "unread", updatedAtMs: 20_000 },
      { id: "child", parentThreadId: "root", status: "working" },
    ]);
    await expect(client.readUsage()).resolves.toMatchObject({
      primary: { usedPercent: 25, windowMinutes: 300 },
    });
    expect(notifications).toContain("account/rateLimits/updated");
    await expect(readFile(marker, "utf8")).resolves.toBe("started\n");

    unsubscribe();
    await client.close();
  });

  it("performs the handshake and ignores interleaved notifications and responses", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let initialized = false;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ method: "account/rateLimits/updated", params: {} });
    send({ id: 99, result: { unrelated: true } });
    send({ id: message.id, result: { userAgent: "fake" } });
  } else if (message.method === "initialized") {
    initialized = true;
  } else if (message.method === "account/rateLimits/read") {
    if (!initialized) {
      send({ id: message.id, error: { code: -32000, message: "not initialized" } });
      return;
    }
    send({ method: "thread/started", params: { thread: {} } });
    send({ id: message.id, result: {
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 18.4, windowDurationMins: 300, resetsAt: 1784000000 },
        secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1784500000 },
        planType: "pro"
      }
    } });
  }
});
`);
    const client = new CodexAppServerClient({
      executable,
      now: () => 123_456,
    });

    await expect(client.readUsage()).resolves.toEqual({
      updatedAtMs: 123_456,
      primary: {
        usedPercent: 18.4,
        windowMinutes: 300,
        resetsAtMs: 1_784_000_000_000,
      },
      secondary: {
        usedPercent: 61,
        windowMinutes: 10_080,
        resetsAtMs: 1_784_500_000_000,
      },
      planType: "pro",
      credits: null,
    });
  });

  it("selects the canonical codex bucket over model-specific meters", () => {
    const usage = usageFromAppServerResult(
      {
        rateLimits: {
          limitId: "codex_bengalfox",
          primary: { usedPercent: 99, windowDurationMins: 10_080 },
        },
        rateLimitsByLimitId: {
          codex_bengalfox: {
            limitId: "codex_bengalfox",
            primary: { usedPercent: 99, windowDurationMins: 10_080 },
          },
          codex: {
            limitId: "codex",
            primary: { usedPercent: 4, windowDurationMins: 10_080 },
          },
        },
      },
      10,
    );

    expect(usage).toMatchObject({
      updatedAtMs: 10,
      primary: { usedPercent: 4, windowMinutes: 10_080 },
    });
  });

  it("preserves credits from the current protocol response", () => {
    expect(
      usageFromAppServerResult({
        rateLimits: {
          limitId: "codex",
          primary: null,
          secondary: null,
          credits: { hasCredits: false, unlimited: true, balance: null },
        },
      }),
    ).toMatchObject({
      primary: null,
      secondary: null,
      credits: { hasCredits: false, unlimited: true, balance: null },
    });
  });

  it("rejects malformed and model-specific-only payloads", async () => {
    expect(
      usageFromAppServerResult({
        rateLimitsByLimitId: {
          codex_bengalfox: {
            primary: { usedPercent: 1, windowDurationMins: 300 },
          },
        },
      }),
    ).toBeNull();
    expect(
      usageFromAppServerResult({
        rate_limits: {
          primary: { used_percent: 1, window_minutes: 300 },
        },
      }),
    ).toBeNull();

    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
    send({ id: message.id, result: { rateLimits: "malformed" } });
  }
});
`);

    await expect(
      new CodexAppServerClient({ executable }).readUsage(),
    ).rejects.toThrow(/Invalid account\/rateLimits\/read result/u);
  });

  it("reconnects after a malformed non-object JSON-RPC result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-reconnect-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "started.txt");
    const executable = await fakeAppServer(`
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const marker = ${JSON.stringify(marker)};
appendFileSync(marker, "started\\n");
const attempt = readFileSync(marker, "utf8").trim().split("\\n").length;
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
    send(attempt === 1
      ? { id: message.id, result: "malformed" }
      : { id: message.id, result: { rateLimits: {
          limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300 }
        } } });
  }
});
`);
    const client = new CodexAppServerClient({ executable });

    await expect(client.readUsage()).rejects.toThrow(
      /Invalid account\/rateLimits\/read result/u,
    );
    await expect(client.readUsage()).resolves.toMatchObject({
      primary: { usedPercent: 12 },
    });
    await expect(readFile(marker, "utf8")).resolves.toBe("started\nstarted\n");
    await client.close();
  });

  it("surfaces a missing current task RPC instead of silently degrading", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "thread/list") send({ id: message.id, result: {
    data: [{ id: "current", cwd: "/tmp/project", preview: "Current",
      path: "/tmp/current.jsonl", updatedAt: 1, recencyAt: 1,
      parentThreadId: null, status: { type: "notLoaded" } }],
    nextCursor: null
  } });
  if (message.method === "thread/turns/list") send({ id: message.id, error: {
    code: -32601, message: "method not found"
  } });
});
`);
    const client = new CodexAppServerClient({ executable });

    await expect(client.readThreads()).rejects.toThrow(/method not found/u);
    await client.close();
  });

  it("keeps healthy threads when one turn read fails", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "thread/list") send({ id: message.id, result: {
    data: [
      { id: "healthy", cwd: "/tmp/project", preview: "Healthy", path: "/tmp/healthy.jsonl",
        updatedAt: 2, recencyAt: 2, parentThreadId: null, status: { type: "notLoaded" } },
      { id: "broken", cwd: "/tmp/project", preview: "Broken", path: "/tmp/broken.jsonl",
        updatedAt: 1, recencyAt: 1, parentThreadId: null, status: { type: "notLoaded" } }
    ], nextCursor: null
  } });
  if (message.method === "thread/turns/list") {
    if (message.params.threadId === "broken") {
      send({ id: message.id, error: { code: -32001, message: "rollout unavailable" } });
    } else {
      send({ id: message.id, result: { data: [{ status: "completed", items: [],
        startedAt: 1, completedAt: 2 }], nextCursor: null } });
    }
  }
});
`);
    const client = new CodexAppServerClient({ executable });

    await expect(client.readThreads()).resolves.toMatchObject([
      { id: "healthy", status: "unread" },
      { id: "broken", status: null },
    ]);
    await client.close();
  });

  it.each([
    ["startup", false],
    ["request", true],
  ])(
    "bounds the %s timeout and terminates the child",
    async (_, initialize) => {
      const directory = await mkdtemp(join(tmpdir(), "chatgato-timeout-"));
      temporaryDirectories.push(directory);
      const marker = join(directory, "pid.txt");
      const server = join(directory, "server.mjs");
      await writeFile(
        server,
        `
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (${JSON.stringify(initialize)} && message.method === "initialize") {
    send({ id: message.id, result: {} });
  }
});
setInterval(() => undefined, 1000);
`,
      );
      const executable = join(directory, "fake-codex");
      await writeFile(
        executable,
        `#!/bin/sh
printf '%s' "$$" > ${shellQuote(marker)}
exec ${shellQuote(process.execPath)} ${shellQuote(server)} "$@"
`,
      );
      await chmod(executable, 0o755);
      const client = new CodexAppServerClient({
        executable,
        requestTimeoutMs: initialize ? 100 : 5_000,
        startupTimeoutMs: initialize ? 5_000 : 1_000,
      });

      await expect(client.readUsage()).rejects.toThrow(/timed out/u);
      const pid = Number(await readFile(marker, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it("coalesces concurrent reads into one app-server process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-single-flight-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "started.txt");
    const executable = await fakeAppServer(`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
appendFileSync(${JSON.stringify(marker)}, "started\\n");
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
    setTimeout(() => send({ id: message.id, result: { rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 25, windowDurationMins: 300 }
    } } }), 50);
  }
});
`);
    const client = new CodexAppServerClient({ executable });

    const reads = [client.readUsage(), client.readUsage(), client.readUsage()];
    expect(reads[1]).toBe(reads[0]);
    expect(reads[2]).toBe(reads[0]);
    await expect(Promise.all(reads)).resolves.toHaveLength(3);
    await expect(readFile(marker, "utf8")).resolves.toBe("started\n");
  });

  it("rereads threads after a notification invalidates an in-flight result", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let listCount = 0;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "thread/list") {
    listCount += 1;
    const id = listCount === 1 ? "stale" : "fresh";
    if (listCount === 1) {
      send({ method: "thread/status/changed", params: {
        threadId: "fresh", status: { type: "idle" }
      } });
    }
    setTimeout(() => send({ id: message.id, result: { data: [
      { id, cwd: "/tmp/project", preview: id, path: "/tmp/" + id + ".jsonl",
        updatedAt: listCount, recencyAt: listCount, parentThreadId: null,
        status: { type: "notLoaded" } }
    ], nextCursor: null } }), listCount === 1 ? 25 : 0);
  }
  if (message.method === "thread/turns/list") send({ id: message.id, result: {
    data: [{ status: "completed", items: [], startedAt: 1, completedAt: 2 }],
    nextCursor: null
  } });
});
`);
    const client = new CodexAppServerClient({ executable });
    let resolveRefresh!: (
      threads: Awaited<ReturnType<typeof client.readThreads>>,
    ) => void;
    const refreshed = new Promise<
      Awaited<ReturnType<typeof client.readThreads>>
    >((resolve) => {
      resolveRefresh = resolve;
    });
    const unsubscribe = client.subscribe((notification) => {
      if (notification.method === "thread/status/changed") {
        void client.readThreads().then(resolveRefresh);
      }
    });

    const stale = client.readThreads();
    await expect(stale).resolves.toMatchObject([{ id: "stale" }]);
    await expect(refreshed).resolves.toMatchObject([{ id: "fresh" }]);

    unsubscribe();
    await client.close();
  });

  it("rereads usage after a sparse update invalidates an in-flight result", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let readCount = 0;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
    readCount += 1;
    if (readCount === 1) {
      send({ method: "account/rateLimits/updated", params: { rateLimits: {} } });
    }
    const usedPercent = readCount === 1 ? 90 : 10;
    setTimeout(() => send({ id: message.id, result: { rateLimits: {
      limitId: "codex", primary: { usedPercent, windowDurationMins: 300 }
    } } }), readCount === 1 ? 25 : 0);
  }
});
`);
    const client = new CodexAppServerClient({ executable });
    let resolveRefresh!: (
      usage: Awaited<ReturnType<typeof client.readUsage>>,
    ) => void;
    const refreshed = new Promise<Awaited<ReturnType<typeof client.readUsage>>>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    const unsubscribe = client.subscribe((notification) => {
      if (notification.method === "account/rateLimits/updated") {
        void client.readUsage().then(resolveRefresh);
      }
    });

    const stale = client.readUsage();
    await expect(stale).resolves.toMatchObject({
      primary: { usedPercent: 90 },
    });
    await expect(refreshed).resolves.toMatchObject({
      primary: { usedPercent: 10 },
    });

    unsubscribe();
    await client.close();
  });

  it("watches config and rereads after a change during config/read", async () => {
    const executable = await fakeAppServer(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const codexHome = "/tmp/fake-codex-home";
let configReads = 0;
let watched = false;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { codexHome } });
  if (message.method === "fs/watch") {
    watched = message.params.path === codexHome && message.params.watchId === "chatgato-config";
    send({ id: message.id, result: { path: codexHome } });
  }
  if (message.method === "config/read") {
    if (!watched) {
      send({ id: message.id, error: { code: -32000, message: "config not watched" } });
      return;
    }
    configReads += 1;
    if (configReads === 1) {
      send({ method: "fs/changed", params: {
        watchId: "chatgato-config", changedPaths: [codexHome + "/config.toml"]
      } });
    }
    const service_tier = configReads === 1 ? "default" : "fast";
    setTimeout(() => send({ id: message.id, result: { config: { service_tier } } }),
      configReads === 1 ? 25 : 0);
  }
});
`);
    const client = new CodexAppServerClient({ executable });
    let resolveRefresh!: (
      config: Awaited<ReturnType<typeof client.readConfig>>,
    ) => void;
    const refreshed = new Promise<
      Awaited<ReturnType<typeof client.readConfig>>
    >((resolve) => {
      resolveRefresh = resolve;
    });
    const unsubscribe = client.subscribe((notification) => {
      if (notification.method === "fs/changed") {
        void client.readConfig().then(resolveRefresh);
      }
    });

    const stale = client.readConfig();
    await expect(stale).resolves.toMatchObject({ service_tier: "default" });
    await expect(refreshed).resolves.toMatchObject({ service_tier: "fast" });

    unsubscribe();
    await client.close();
  });

  it("keeps reads available when config watch registration times out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-watch-timeout-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "started.txt");
    const executable = await fakeAppServer(`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
appendFileSync(${JSON.stringify(marker)}, "started\\n");
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let configReads = 0;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { codexHome: "/tmp/fake-codex-home" } });
  }
  if (message.method === "config/read") {
    configReads += 1;
    send({ id: message.id, result: {
      config: { service_tier: configReads === 1 ? "default" : "fast" }
    } });
  }
  if (message.method === "model/list") send({ id: message.id, result: {
    data: [{ id: "gpt-test", supportedReasoningEfforts: [] }], nextCursor: null
  } });
  if (message.method === "thread/list") send({ id: message.id, result: {
    data: [{ id: "thread", cwd: "/tmp/project", preview: "Thread",
      path: "/tmp/thread.jsonl", updatedAt: 1, recencyAt: 1,
      parentThreadId: null, status: { type: "notLoaded" } }], nextCursor: null
  } });
  if (message.method === "thread/turns/list") send({ id: message.id, result: {
    data: [{ status: "completed", items: [], startedAt: 1, completedAt: 2 }],
    nextCursor: null
  } });
  if (message.method === "account/rateLimits/read") send({ id: message.id, result: {
    rateLimits: { limitId: "codex",
      primary: { usedPercent: 25, windowDurationMins: 300 } }
  } });
});
`);
    let now = 0;
    const client = new CodexAppServerClient({
      executable,
      now: () => now,
      requestTimeoutMs: 250,
    });

    const [config, models, threads, usage] = await Promise.all([
      client.readConfig(),
      client.readModels(),
      client.readThreads(),
      client.readUsage(),
    ]);
    expect(config).toMatchObject({ service_tier: "default" });
    expect(models).toMatchObject([{ id: "gpt-test" }]);
    expect(threads).toMatchObject([{ id: "thread", status: "unread" }]);
    expect(usage).toMatchObject({ primary: { usedPercent: 25 } });

    await delay(300);
    now = 751;
    await expect(client.readConfig()).resolves.toMatchObject({
      service_tier: "fast",
    });
    await expect(client.readUsage()).resolves.toMatchObject({
      primary: { usedPercent: 25 },
    });
    await expect(readFile(marker, "utf8")).resolves.toBe("started\n");
    await client.close();
  });

  it("keeps one process alive and reflects the next live response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-early-reset-"));
    temporaryDirectories.push(directory);
    const counter = join(directory, "count.txt");
    const executable = await fakeAppServer(`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const counter = ${JSON.stringify(counter)};
appendFileSync(counter, "started\\n");
let count = 0;
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
    count += 1;
    send({ id: message.id, result: { rateLimits: {
      limitId: "codex",
      primary: {
        usedPercent: count === 1 ? 82 : 0,
        windowDurationMins: 300,
        resetsAt: count === 1 ? 1784000000 : 1784018000
      }
    } } });
  }
});
`);
    const client = new CodexAppServerClient({ executable });

    const beforeReset = await client.readUsage();
    const afterReset = await client.readUsage();
    expect(remainingPercent(beforeReset.primary!)).toBe(18);
    expect(remainingPercent(afterReset.primary!)).toBe(100);
    expect(afterReset.primary!.resetsAtMs).toBe(1_784_018_000_000);
    await expect(readFile(counter, "utf8")).resolves.toBe("started\n");
  });
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
