import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { expect, it } from "vitest";
import { decryptT3CatalogWithKey } from "../src/lib/t3-safe-storage.js";

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
