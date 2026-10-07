import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LevelDbReader, maskedCrc32c } from "../src/lib/leveldb-reader.js";
import { batch, log, manifest, table } from "./helpers/leveldb-fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "chatgato-leveldb-"));
  directories.push(path);
  await writeFile(join(path, "CURRENT"), "MANIFEST-000001\n");
  await writeFile(join(path, "MANIFEST-000001"), manifest([2]));
  return path;
}
const b = (s: string) => Buffer.from(s);

it("matches the standard CRC32C test vector", () => {
  const crc = 0xe3069283;
  expect(maskedCrc32c(b("123456789"))).toBe(
    (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0,
  );
});
it("combines compressed SSTs and WAL updates, honoring tombstones and the manifest", async () => {
  const dir = await fixture();
  await writeFile(
    join(dir, "000002.ldb"),
    table(10, [
      [b("task-a"), b("working")],
      [b("task-b"), b("deleted")],
    ]),
  );
  await writeFile(
    join(dir, "000003.log"),
    log([
      batch(20, [
        [b("task-a"), b("done")],
        [b("task-b"), null],
      ]),
    ]),
  );
  await writeFile(
    join(dir, "000009.ldb"),
    table(999, [[b("obsolete"), b("do not revive")]]),
  );
  await writeFile(
    join(dir, "000001.log"),
    log([batch(999, [[b("old-log"), b("ignore")]])]),
  );
  const reader = new LevelDbReader();
  expect(
    (await reader.read(dir)).map(({ key, value }) => [
      key.toString(),
      value?.toString(),
    ]),
  ).toEqual([["task-a", "done"]]);
  await writeFile(join(dir, "MANIFEST-000001"), manifest([]));
  expect((await reader.read(dir)).map((e) => e.key.toString())).toEqual([
    "task-a",
  ]);
});
it("ignores an incomplete final batch but reads complete multi-block records", async () => {
  const dir = await fixture();
  await writeFile(join(dir, "MANIFEST-000001"), manifest([]));
  const big = Buffer.alloc(100000, 65);
  const records = log([
    batch(1, [[b("big"), big]]),
    batch(2, [[b("partial"), big]]),
  ]);
  await writeFile(join(dir, "000003.log"), records.subarray(0, -20));
  const result = await new LevelDbReader().read(dir);
  expect(result).toHaveLength(1);
  expect(result[0]!.value).toEqual(big);
});
it("rejects damaged records instead of reporting stale or corrupt status", async () => {
  const dir = await fixture();
  const data = table(1, [[b("task"), b("running")]]);
  data[4] = data[4]! ^ 1;
  await writeFile(join(dir, "000002.ldb"), data);
  await expect(new LevelDbReader().read(dir)).rejects.toThrow("checksum");
  await writeFile(
    join(dir, "000002.ldb"),
    table(1, [[b("task"), b("running")]]),
  );
  const wal = log([batch(2, [[b("task"), b("done")]])]);
  wal[0] = wal[0]! ^ 1;
  await writeFile(join(dir, "000003.log"), wal);
  await expect(new LevelDbReader().read(dir)).rejects.toThrow("checksum");
});
it("rejects a CURRENT path outside the database", async () => {
  const dir = await fixture();
  await mkdir(join(dir, "child"));
  await writeFile(join(dir, "CURRENT"), "../anything");
  await expect(new LevelDbReader().read(dir)).rejects.toThrow("manifest name");
});
