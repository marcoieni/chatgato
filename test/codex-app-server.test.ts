import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerConfigClient,
  CodexAppServerUsageClient,
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
    const client = new CodexAppServerUsageClient({
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

  it("accepts compatible snake_case fields and preserves credits", () => {
    expect(
      usageFromAppServerResult({
        rate_limits_by_limit_id: {
          codex: {
            limit_id: "codex",
            plan_type: "team",
            primary: {
              used_percent: 12,
              window_minutes: 300,
              resets_at: 1_784_000_000,
            },
            credits: {
              has_credits: true,
              unlimited: false,
              balance: "42.5",
            },
          },
        },
      }),
    ).toMatchObject({
      planType: "team",
      primary: { usedPercent: 12, windowMinutes: 300 },
      credits: { hasCredits: true, unlimited: false, balance: "42.5" },
    });

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
      new CodexAppServerUsageClient({ executable }).readUsage(),
    ).rejects.toThrow(/Invalid account\/rateLimits\/read result/u);
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
      const client = new CodexAppServerUsageClient({
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
    const client = new CodexAppServerUsageClient({ executable });

    const reads = [client.readUsage(), client.readUsage(), client.readUsage()];
    expect(reads[1]).toBe(reads[0]);
    expect(reads[2]).toBe(reads[0]);
    await expect(Promise.all(reads)).resolves.toHaveLength(3);
    await expect(readFile(marker, "utf8")).resolves.toBe("started\n");
  });

  it("reflects an early reset from the next live response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-early-reset-"));
    temporaryDirectories.push(directory);
    const counter = join(directory, "count.txt");
    const executable = await fakeAppServer(`
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const counter = ${JSON.stringify(counter)};
const count = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;
writeFileSync(counter, String(count));
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "account/rateLimits/read") {
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
    const client = new CodexAppServerUsageClient({ executable });

    const beforeReset = await client.readUsage();
    const afterReset = await client.readUsage();
    expect(remainingPercent(beforeReset.primary!)).toBe(18);
    expect(remainingPercent(afterReset.primary!)).toBe(100);
    expect(afterReset.primary!.resetsAtMs).toBe(1_784_018_000_000);
  });
});

describe("Codex app-server config", () => {
  it.each([
    [true, "priority"],
    [false, "default"],
  ])(
    "persists Fast mode %s as service tier %s",
    async (enabled, serviceTier) => {
      const directory = await mkdtemp(
        join(tmpdir(), "chatgato-config-server-"),
      );
      temporaryDirectories.push(directory);
      const marker = join(directory, "request.json");
      const executable = await fakeAppServer(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let initialized = false;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: {} });
  } else if (message.method === "initialized") {
    initialized = true;
  } else if (message.method === "config/batchWrite") {
    writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ initialized, params: message.params }));
    send({ id: message.id, result: {} });
  }
});
`);
      const client = new CodexAppServerConfigClient({ executable });

      await expect(client.setFastMode(enabled)).resolves.toBeUndefined();
      await expect(readFile(marker, "utf8").then(JSON.parse)).resolves.toEqual({
        initialized: true,
        params: {
          edits: [
            {
              keyPath: "service_tier",
              mergeStrategy: "upsert",
              value: serviceTier,
            },
          ],
          expectedVersion: null,
          filePath: null,
          reloadUserConfig: true,
        },
      });
    },
  );
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
