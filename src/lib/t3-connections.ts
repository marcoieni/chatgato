import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { decryptT3Catalog } from "./t3-safe-storage.js";

export type T3SshConnection = { host: string; port?: number };
export type T3Connection = T3SshConnection | { environmentId: string };

export function isT3SshHost(host: string): boolean {
  return /^[a-z0-9_][a-z0-9_.@:[\]-]*$/i.test(host);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function connection(value: unknown): T3SshConnection | null {
  const target = object(value);
  const alias = typeof target.alias === "string" ? target.alias.trim() : "";
  const hostname =
    typeof target.hostname === "string" ? target.hostname.trim() : "";
  const destination = alias || hostname;
  const username = target.username;
  if (
    username != null &&
    (typeof username !== "string" || !/^[a-z0-9_.-]+$/i.test(username))
  )
    return null;
  const host = username ? `${username}@${destination}` : destination;
  if (!isT3SshHost(host)) return null;
  if (
    target.port != null &&
    (typeof target.port !== "number" ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535)
  )
    return null;
  return {
    host,
    ...(target.port == null ? {} : { port: target.port as number }),
  };
}

function connectionsFromDocument(
  document: unknown,
  catalog: boolean,
): T3Connection[] {
  const data = object(document);
  let targets: unknown[];
  if (catalog) {
    if (
      data.schemaVersion !== 1 ||
      !Array.isArray(data.profiles) ||
      !Array.isArray(data.targets) ||
      (data.disabledEnvironmentIds !== undefined &&
        !Array.isArray(data.disabledEnvironmentIds))
    )
      throw new Error("Unsupported T3 connection catalog");
    const disabled = new Set(
      data.disabledEnvironmentIds as unknown[] | undefined,
    );
    targets = data.profiles
      .filter((value) => {
        const profile = object(value);
        return (
          profile._tag === "SshConnectionProfile" &&
          !disabled.has(profile.environmentId) &&
          (data.targets as unknown[]).some((value) => {
            const target = object(value);
            return (
              target._tag === "SshConnectionTarget" &&
              target.connectionId === profile.connectionId &&
              target.environmentId === profile.environmentId
            );
          })
        );
      })
      .map((value) => object(value).target);
  } else {
    if (
      (data.version !== undefined && data.version !== 1) ||
      !Array.isArray(data.records)
    )
      throw new Error("Unsupported T3 saved environment registry");
    targets = data.records
      .filter((value) => !object(value).relayManaged)
      .map((value) => object(value).desktopSsh);
  }
  const connections: T3Connection[] = targets
    .map(connection)
    .filter((value) => value !== null);
  if (catalog) {
    const disabled = new Set(
      data.disabledEnvironmentIds as unknown[] | undefined,
    );
    for (const value of data.targets as unknown[]) {
      const target = object(value);
      if (
        target._tag === "RelayConnectionTarget" &&
        typeof target.environmentId === "string" &&
        target.environmentId &&
        !disabled.has(target.environmentId)
      )
        connections.push({ environmentId: target.environmentId });
    }
  } else {
    for (const value of data.records as unknown[]) {
      const record = object(value);
      if (
        record.relayManaged &&
        typeof record.environmentId === "string" &&
        record.environmentId
      )
        connections.push({ environmentId: record.environmentId });
    }
  }
  return [
    ...new Map(
      connections.map((value) => [JSON.stringify(value), value]),
    ).values(),
  ];
}

/** Cache only connection metadata, never the decrypted catalog or its credentials. */
export class T3Connections {
  private readonly catalogs = new Map<
    string,
    {
      encrypted: string;
      connections: Promise<T3Connection[]>;
      retryAt: number;
    }
  >();
  constructor(private readonly decrypt = decryptT3Catalog) {}

  readonly discover = async (home?: string): Promise<T3Connection[]> => {
    const t3Home = home || process.env.T3CODE_HOME || join(homedir(), ".t3");
    if (!isAbsolute(t3Home))
      throw new Error("T3 Code home must be an absolute path");
    const path = join(t3Home, "userdata", "connection-catalog.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Could not read T3 connection catalog", {
          cause: error,
        });
      try {
        const legacy = await readFile(
          join(t3Home, "userdata", "saved-environments.json"),
          "utf8",
        );
        return connectionsFromDocument(JSON.parse(legacy), false);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        // eslint-disable-next-line preserve-caught-error -- JSON errors may contain saved credentials.
        throw new Error("Could not read T3 saved environment registry");
      }
    }
    // Do not fall back to the legacy registry when a catalog exists: it can
    // contain connections that the user has since removed or disabled.
    try {
      const document = object(JSON.parse(raw));
      if (
        document.version !== 1 ||
        typeof document.encryptedCatalog !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          document.encryptedCatalog,
        ) ||
        !document.encryptedCatalog
      )
        throw new Error();
      const encrypted = document.encryptedCatalog;
      const previous = this.catalogs.get(path);
      if (previous?.encrypted === encrypted && previous.retryAt > Date.now())
        return await previous.connections;
      const cached = {
        encrypted,
        retryAt: Infinity,
        connections: this.decrypt(encrypted)
          .then((plaintext) =>
            connectionsFromDocument(JSON.parse(plaintext), true),
          )
          .catch(() => {
            throw new Error("Could not decode T3 connection metadata");
          }),
      };
      this.catalogs.set(path, cached);
      void cached.connections.catch(() => {
        cached.retryAt = Date.now() + 60_000;
      });
      return await cached.connections;
    } catch {
      // JSON parse errors can include decrypted credential text. Never retain them.
      throw new Error("Could not read or unlock T3 Code connection catalog");
    }
  };
}
