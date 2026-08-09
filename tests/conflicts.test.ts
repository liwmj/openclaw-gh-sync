import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFLICT_RE, findConflictFiles, parseConflictFile, resolveConflicts } from "../src/conflicts.js";

describe("conflicts", () => {
  it("detects conflict sidecar files", () => {
    expect(CONFLICT_RE.test("openclaw/a.conflict.2026-01-01T00-00-00")).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "cf-"));
    mkdirSync(join(dir, "openclaw"), { recursive: true });
    writeFileSync(join(dir, "openclaw", "a.txt"), "x");
    writeFileSync(join(dir, "openclaw", "a.txt.conflict.2026-01-01T00-00-00"), "y");
    const found = findConflictFiles(dir);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("a.txt.conflict");
    rmSync(dir, { recursive: true, force: true });
  });
  it("parses base/label/timestamp", () => {
    const parsed = parseConflictFile("openclaw/a.txt.local-conflict.2026-01-01T00-00-00");
    expect(parsed?.base).toBe("openclaw/a.txt");
    expect(parsed?.label).toBe("local-conflict");
  });
  it("accept-copy overwrites base then deletes sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-"));
    writeFileSync(join(dir, "a.txt"), "base");
    const side = "a.txt.conflict.2026-01-01T00-00-00";
    writeFileSync(join(dir, side), "winner");
    const res = resolveConflicts(dir, "accept-copy", [join(dir, side)]);
    expect(res.strategy).toBe("accept-copy");
    expect(res.files).toHaveLength(1);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("winner");
    rmSync(dir, { recursive: true, force: true });
  });
});
