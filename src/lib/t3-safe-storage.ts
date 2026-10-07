import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Electron's OSCrypt v10 format, as used by T3's safeStorage.encryptString.
// https://github.com/chromium/chromium/tree/145.0.7632.0/components/os_crypt/sync
export function decryptT3CatalogWithKey(
  encrypted: Buffer,
  key: Buffer,
  platform: "darwin" | "win32",
): string {
  if (encrypted.subarray(0, 3).toString() !== "v10")
    throw new Error("Unsupported T3 catalog encryption");
  const decipher =
    platform === "darwin"
      ? createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32))
      : createDecipheriv(
          "aes-256-gcm",
          key,
          encrypted.subarray(3, 15),
        ).setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([
    decipher.update(
      platform === "darwin"
        ? encrypted.subarray(3)
        : encrypted.subarray(15, -16),
    ),
    decipher.final(),
  ]).toString("utf8");
}

function validateCatalog(plaintext: string): string {
  const document: unknown = JSON.parse(plaintext);
  if (
    !document ||
    typeof document !== "object" ||
    !("schemaVersion" in document) ||
    document.schemaVersion !== 1 ||
    !("profiles" in document) ||
    !Array.isArray(document.profiles) ||
    !("targets" in document) ||
    !Array.isArray(document.targets) ||
    ("disabledEnvironmentIds" in document &&
      document.disabledEnvironmentIds !== undefined &&
      !Array.isArray(document.disabledEnvironmentIds))
  )
    throw new Error("Unsupported T3 connection catalog");
  return plaintext;
}

function secretCommand(
  command: string,
  args: string[],
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => {
        // Never propagate process output or arguments from secret-store operations.
        if (error)
          reject(new Error("Could not unlock T3 Code connection catalog"));
        else resolve(stdout.trim());
      },
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

export async function decryptT3Catalog(encoded: string): Promise<string> {
  const encrypted = Buffer.from(encoded, "base64");
  if (process.platform === "darwin") {
    for (const app of ["T3 Code (Alpha)", "T3 Code (Nightly)", "T3 Code"]) {
      try {
        const password = await secretCommand("/usr/bin/security", [
          "find-generic-password",
          "-w",
          "-s",
          `${app} Safe Storage`,
          "-a",
          app,
        ]);
        const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
        try {
          // CBC padding alone cannot distinguish the owning release's key.
          return validateCatalog(
            decryptT3CatalogWithKey(encrypted, key, "darwin"),
          );
        } finally {
          key.fill(0);
        }
      } catch {
        /* Another installed T3 release may own this catalog. */
      }
    }
  } else if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    for (const directory of ["T3 Code (Alpha)", "t3code"]) {
      try {
        const state = JSON.parse(
          await readFile(join(appData, directory, "Local State"), "utf8"),
        );
        const wrapped = Buffer.from(state.os_crypt.encrypted_key, "base64");
        if (wrapped.subarray(0, 5).toString() !== "DPAPI") continue;
        const raw = await secretCommand(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))",
          ],
          wrapped.subarray(5).toString("base64"),
        );
        const key = Buffer.from(raw, "base64");
        try {
          return validateCatalog(
            decryptT3CatalogWithKey(encrypted, key, "win32"),
          );
        } finally {
          key.fill(0);
        }
      } catch {
        /* Try T3's other supported user-data directory. */
      }
    }
  }
  throw new Error(
    "Could not unlock T3 Code connection catalog; encrypted discovery requires access to T3's macOS Keychain or Windows user key",
  );
}
