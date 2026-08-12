import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirp, ensureFileMode } from "../src/fsutil.js";

describe("fsutil", () => {
  it("mkdirp creates nested directories", () => {
    const root = mkdtempSync(join(tmpdir(), "fsu-"));
    const nested = join(root, "a", "b", "c");
    mkdirp(nested);
    expect(existsSync(nested)).toBe(true);
    // idempotent
    mkdirp(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("ensureFileMode is a safe noop that does not throw (real chmod lives in credentials.ts)", () => {
    const root = mkdtempSync(join(tmpdir(), "fsu-"));
    const f = join(root, "x.txt");
    writeFileSync(f, "x");
    expect(() => ensureFileMode(f, 0o600)).not.toThrow();
    expect(() => ensureFileMode(join(root, "missing.txt"), 0o600)).not.toThrow();
  });
});
