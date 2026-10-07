import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { T3Connections } from "../src/lib/t3-connections.js";

const homes: string[] = [];
async function fixture(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "chatgato-t3-connections-"));
  homes.push(home);
  await mkdir(join(home, "userdata"));
  return home;
}
async function write(home: string, name: string, data: unknown) {
  await writeFile(join(home, "userdata", name), JSON.stringify(data));
}
const ssh = {
  alias: "devbox",
  hostname: "resolved",
  username: "marco",
  port: 2222,
};
function catalog(target = ssh) {
  return {
    schemaVersion: 1,
    targets: [
      {
        _tag: "SshConnectionTarget",
        connectionId: "ssh:one",
        environmentId: "one",
      },
    ],
    profiles: [
      {
        _tag: "SshConnectionProfile",
        connectionId: "ssh:one",
        environmentId: "one",
        target,
      },
    ],
    credentials: [{ credential: { token: "must-not-leak" } }],
    disabledEnvironmentIds: [] as string[],
  };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

it("discovers only enabled T3 Connect environments without retaining relay credentials", async () => {
  const home = await fixture();
  await write(home, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e30=",
  });
  const data = {
    ...catalog(),
    targets: [
      ...catalog().targets,
      { _tag: "RelayConnectionTarget", environmentId: "relay" },
      { _tag: "RelayConnectionTarget", environmentId: "relay" },
      { _tag: "RelayConnectionTarget", environmentId: "disabled" },
      { _tag: "RelayConnectionTarget", environmentId: "" },
    ],
    remoteDpopTokens: [
      { environmentId: "relay", accessToken: "must-not-retain" },
    ],
    disabledEnvironmentIds: ["disabled"],
  };
  expect(
    await new T3Connections(async () => JSON.stringify(data)).discover(home),
  ).toEqual([{ host: "marco@devbox", port: 2222 }, { environmentId: "relay" }]);
});

it("discovers relay environment identities in the legacy registry", async () => {
  const home = await fixture();
  await write(home, "saved-environments.json", {
    records: [
      {
        environmentId: "relay",
        relayManaged: { relayUrl: "https://relay.example" },
      },
    ],
  });
  expect(await new T3Connections().discover(home)).toEqual([
    { environmentId: "relay" },
  ]);
});

it("reads only saved SSH connections, retaining username and port and deduplicating them", async () => {
  const home = await fixture();
  await write(home, "saved-environments.json", {
    version: 1,
    records: [
      { desktopSsh: ssh },
      { desktopSsh: ssh },
      {
        desktopSsh: {
          alias: "",
          hostname: "other",
          username: null,
          port: null,
        },
      },
      { httpBaseUrl: "https://not-ssh", encryptedBearerToken: "secret" },
      { desktopSsh: ssh, relayManaged: {} },
      { desktopSsh: { ...ssh, alias: "-oProxyCommand=bad" } },
      { desktopSsh: { ...ssh, username: "user;bad" } },
      { desktopSsh: { ...ssh, port: -1 } },
    ],
  });
  expect(await new T3Connections().discover(home)).toEqual([
    { host: "marco@devbox", port: 2222 },
    { host: "other" },
  ]);
});

it("prefers the encrypted catalog and never revives legacy, disabled or orphaned connections", async () => {
  const home = await fixture();
  await write(home, "saved-environments.json", {
    records: [{ desktopSsh: ssh }],
  });
  await write(home, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e30=",
  });
  const data = catalog();
  data.disabledEnvironmentIds = ["one"];
  data.profiles.push({
    ...data.profiles[0]!,
    environmentId: "orphan",
    connectionId: "orphan",
  });
  const decrypt = vi.fn(async () => JSON.stringify(data));
  expect(await new T3Connections(decrypt).discover(home)).toEqual([]);
  expect(decrypt).toHaveBeenCalledWith("e30=");
});

it("caches extracted connections per home and only refreshes a changed catalog", async () => {
  const home = await fixture();
  const otherHome = await fixture();
  await write(home, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e30=",
  });
  await write(otherHome, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e31=",
  });
  const decrypt = vi.fn(async (encrypted: string) =>
    JSON.stringify(
      catalog({ ...ssh, alias: encrypted === "e30=" ? "devbox" : "other" }),
    ),
  );
  const connections = new T3Connections(decrypt);
  expect(await connections.discover(home)).toEqual([
    { host: "marco@devbox", port: 2222 },
  ]);
  expect(await connections.discover(otherHome)).toEqual([
    { host: "marco@other", port: 2222 },
  ]);
  await connections.discover(home);
  await connections.discover(otherHome);
  expect(decrypt).toHaveBeenCalledTimes(2);
  await write(home, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e32=",
  });
  decrypt.mockResolvedValue(JSON.stringify({ ...catalog(), targets: [] }));
  expect(await connections.discover(home)).toEqual([]);
  expect(await connections.discover(otherHome)).toEqual([
    { host: "marco@other", port: 2222 },
  ]);
  expect(decrypt).toHaveBeenCalledTimes(3);
  expect(decrypt).toHaveBeenLastCalledWith("e32=");
});

it("does not expose decrypted secrets or fall back, and backs off retries per home", async () => {
  vi.useFakeTimers();
  const home = await fixture();
  const otherHome = await fixture();
  await write(home, "saved-environments.json", {
    records: [{ desktopSsh: ssh }],
  });
  await write(home, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e30=",
  });
  await write(otherHome, "connection-catalog.json", {
    version: 1,
    encryptedCatalog: "e31=",
  });
  const decrypt = vi.fn(async () => "must-not-leak");
  const connections = new T3Connections(decrypt);
  await expect(connections.discover(home)).rejects.toThrow(
    "Could not read or unlock T3 Code connection catalog",
  );
  vi.advanceTimersByTime(30_000);
  await expect(connections.discover(otherHome)).rejects.not.toThrow(
    "must-not-leak",
  );
  await expect(connections.discover(home)).rejects.not.toThrow("must-not-leak");
  await expect(connections.discover(otherHome)).rejects.not.toThrow(
    "must-not-leak",
  );
  expect(decrypt).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(30_000);
  decrypt.mockResolvedValue(JSON.stringify(catalog()));
  expect(await connections.discover(home)).toHaveLength(1);
  await expect(connections.discover(otherHome)).rejects.not.toThrow(
    "must-not-leak",
  );
  expect(decrypt).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(30_000);
  expect(await connections.discover(otherHome)).toHaveLength(1);
  expect(decrypt).toHaveBeenCalledTimes(4);
});

it("shares pending unlocks even when another home is discovered in between", async () => {
  const home = await fixture();
  const otherHome = await fixture();
  for (const path of [home, otherHome]) {
    await write(path, "connection-catalog.json", {
      version: 1,
      encryptedCatalog: "e30=",
    });
  }
  const unlock = Promise.withResolvers<string>();
  const decrypt = vi.fn(() => unlock.promise);
  const connections = new T3Connections(decrypt);
  const first = connections.discover(home);
  await vi.waitFor(() => expect(decrypt).toHaveBeenCalledOnce());
  const other = connections.discover(otherHome);
  await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
  const repeated = connections.discover(home);
  unlock.resolve(JSON.stringify(catalog()));
  expect(await Promise.all([first, other, repeated])).toEqual([
    [{ host: "marco@devbox", port: 2222 }],
    [{ host: "marco@devbox", port: 2222 }],
    [{ host: "marco@devbox", port: 2222 }],
  ]);
  expect(decrypt).toHaveBeenCalledTimes(2);
});

it("uses T3CODE_HOME and handles missing registries without scanning SSH config", async () => {
  const home = await fixture();
  vi.stubEnv("T3CODE_HOME", home);
  const connections = new T3Connections();
  expect(await connections.discover()).toEqual([]);
  await write(home, "saved-environments.json", {
    records: [{ desktopSsh: ssh }],
  });
  expect(await connections.discover()).toEqual([
    { host: "marco@devbox", port: 2222 },
  ]);
  await write(home, "saved-environments.json", { records: [] });
  expect(await connections.discover()).toEqual([]);
});

it.each([
  { version: 2, encryptedCatalog: "e30=" },
  { version: 1, encryptedCatalog: "invalid!" },
  { version: 1, encryptedCatalog: "" },
])(
  "rejects malformed encrypted catalog envelopes before unlocking them",
  async (document) => {
    const home = await fixture();
    await write(home, "connection-catalog.json", document);
    const decrypt = vi.fn();
    await expect(new T3Connections(decrypt).discover(home)).rejects.toThrow(
      "connection catalog",
    );
    expect(decrypt).not.toHaveBeenCalled();
  },
);
