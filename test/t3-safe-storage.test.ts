import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), readFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
import {
  decryptT3Catalog,
  decryptT3CatalogWithKey,
} from "../src/lib/t3-safe-storage.js";

const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function nativeSecrets(platform: string, ...results: (string | Error)[]) {
  Object.defineProperty(process, "platform", { value: platform });
  const stdin = { on: vi.fn(), end: vi.fn() };
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    const result = results.shift() ?? new Error("Secret unavailable");
    queueMicrotask(() =>
      callback(result instanceof Error ? result : null, result, ""),
    );
    return { stdin };
  });
  return stdin;
}

function encryptMacCatalog(plaintext: string, password: string): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(plaintext),
    cipher.final(),
  ]);
}

it("reads Chromium's macOS v10 CBC format with its PBKDF2-derived key", () => {
  const key = pbkdf2Sync(
    "test-keychain-password",
    "saltysalt",
    1003,
    16,
    "sha1",
  );
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const plaintext = JSON.stringify({ profiles: [], label: "工作" });
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    cipher.update(plaintext),
    cipher.final(),
  ]);
  expect(decryptT3CatalogWithKey(encrypted, key, "darwin")).toBe(plaintext);
});

it("reads Windows v10 GCM data with the unwrapped key and rejects tampered data", () => {
  const key = Buffer.alloc(32, 7);
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = JSON.stringify({ profiles: [] });
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    nonce,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  expect(decryptT3CatalogWithKey(encrypted, key, "win32")).toBe(plaintext);
  encrypted[15] = encrypted[15]! ^ 1;
  expect(() => decryptT3CatalogWithKey(encrypted, key, "win32")).toThrow();
});

it("rejects unknown encryption versions", () => {
  expect(() =>
    decryptT3CatalogWithKey(
      Buffer.from("v20payload"),
      Buffer.alloc(16),
      "darwin",
    ),
  ).toThrow("Unsupported");
});

it("unlocks packaged T3 using the package-name service and Electron Key account", async () => {
  const plaintext = JSON.stringify({
    schemaVersion: 1,
    profiles: [],
    targets: [],
  });
  const password = "packaged-t3-keychain-password";
  nativeSecrets("darwin", password);
  const encrypted = encryptMacCatalog(plaintext, password);

  await expect(decryptT3Catalog(encrypted.toString("base64"))).resolves.toBe(
    plaintext,
  );
  expect(mocks.execFile).toHaveBeenCalledExactlyOnceWith(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-w",
      "-s",
      "t3code Safe Storage",
      "-a",
      "t3code Key",
    ],
    expect.objectContaining({ timeout: 0 }),
    expect.any(Function),
  );
});

it("tries the next macOS release when a wrong key produces valid CBC padding", async () => {
  const plaintext = JSON.stringify({
    schemaVersion: 1,
    profiles: [],
    targets: [],
  });
  const wrongPassword = "alpha-keychain-password-16";
  const password = "nightly-keychain-password";
  const encrypted = encryptMacCatalog(plaintext, password);
  const wrongKey = pbkdf2Sync(wrongPassword, "saltysalt", 1003, 16, "sha1");
  // This fixed wrong key decrypts without a padding error, but is not a catalog.
  const invalidPlaintext = decryptT3CatalogWithKey(
    encrypted,
    wrongKey,
    "darwin",
  );
  expect(() => JSON.parse(invalidPlaintext)).toThrow();
  nativeSecrets("darwin", wrongPassword, password);

  await expect(decryptT3Catalog(encrypted.toString("base64"))).resolves.toBe(
    plaintext,
  );
  expect(mocks.execFile).toHaveBeenCalledTimes(2);
  for (const [index, app] of ["t3code", "T3 Code (Alpha)"].entries()) {
    expect(mocks.execFile).toHaveBeenNthCalledWith(
      index + 1,
      "/usr/bin/security",
      [
        "find-generic-password",
        "-w",
        "-s",
        `${app} Safe Storage`,
        "-a",
        `${app} Key`,
      ],
      expect.objectContaining({ timeout: 0 }),
      expect.any(Function),
    );
  }
});

it.each([
  "null",
  "[]",
  '{"schemaVersion":2,"profiles":[],"targets":[]}',
  '{"schemaVersion":1,"profiles":[]}',
  '{"schemaVersion":1,"profiles":[],"targets":[],"disabledEnvironmentIds":null}',
])(
  "rejects decrypted data that is not a version 1 catalog: %s",
  async (plaintext) => {
    const password = "keychain-password";
    nativeSecrets("darwin", password, password, password, password);
    const encrypted = encryptMacCatalog(plaintext, password);
    await expect(
      decryptT3Catalog(encrypted.toString("base64")),
    ).rejects.toThrow("Could not unlock T3 Code connection catalog");
    expect(mocks.execFile).toHaveBeenCalledTimes(4);
  },
);

it("does not expose native helper output or decrypted text when every key fails", async () => {
  const password = "private-keychain-password";
  nativeSecrets(
    "darwin",
    new Error("Command failed: secret credential"),
    password,
    new Error("Another secret credential"),
  );
  const encrypted = encryptMacCatalog(
    "invalid JSON containing secrets",
    password,
  );
  const decryption = decryptT3Catalog(encrypted.toString("base64"));
  await expect(decryption).rejects.toMatchObject({
    message:
      "Could not unlock T3 Code connection catalog; encrypted discovery requires access to T3's macOS Keychain or Windows user key",
  });
  await expect(decryption).rejects.not.toHaveProperty("cause");
});

it("unwraps a Windows user key through native helper stdin before decrypting the catalog", async () => {
  vi.stubEnv("APPDATA", "/test/roaming");
  const key = Buffer.alloc(32, 7);
  const wrappedKey = Buffer.from("wrapped user key");
  const stdin = nativeSecrets("win32", key.toString("base64"));
  mocks.readFile.mockResolvedValue(
    JSON.stringify({
      os_crypt: {
        encrypted_key: Buffer.concat([
          Buffer.from("DPAPI"),
          wrappedKey,
        ]).toString("base64"),
      },
    }),
  );
  const plaintext = JSON.stringify({
    schemaVersion: 1,
    profiles: [],
    targets: [],
  });
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    nonce,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  await expect(decryptT3Catalog(encrypted.toString("base64"))).resolves.toBe(
    plaintext,
  );
  expect(mocks.readFile).toHaveBeenCalledWith(
    join("/test/roaming", "T3 Code (Alpha)", "Local State"),
    "utf8",
  );
  expect(mocks.execFile).toHaveBeenCalledWith(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", expect.any(String)],
    expect.objectContaining({ timeout: 10_000 }),
    expect.any(Function),
  );
  expect(stdin.end).toHaveBeenCalledWith(wrappedKey.toString("base64"));
});
