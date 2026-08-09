import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAllToMirror, copyMirrorToSources } from "../src/mirror.js";
import type { MirrorEntry } from "../src/types.js";

function entry(srcRoot: string, tgtRoot: string, rel: string): MirrorEntry {
  return { relative: rel, source: join(srcRoot, rel), target: join(tgtRoot, rel) };
}

describe("mirror", () => {
  it("copies sources to mirror and back", () => {
    const src = mkdtempSync(join(tmpdir(), "m-src-"));
    const tgt = mkdtempSync(join(tmpdir(), "m-tgt-"));
    mkdirSync(join(src, "workspace"), { recursive: true });
    writeFileSync(join(src, "workspace", "a.txt"), "data");
    const entries = [entry(src, tgt, "workspace")];
    expect(copyAllToMirror(entries, () => false)).toBe(1);
    expect(readFileSync(join(tgt, "workspace", "a.txt"), "utf8")).toBe("data");
    writeFileSync(join(tgt, "workspace", "a.txt"), "remote-data");
    expect(copyMirrorToSources(entries, () => false)).toBe(1);
    expect(readFileSync(join(src, "workspace", "a.txt"), "utf8")).toBe("remote-data");
    rmSync(src, { recursive: true, force: true });
    rmSync(tgt, { recursive: true, force: true });
  });
  it("skips excluded paths", () => {
    const src = mkdtempSync(join(tmpdir(), "m-src-"));
    const tgt = mkdtempSync(join(tmpdir(), "m-tgt-"));
    mkdirSync(join(src, "workspace"), { recursive: true });
    writeFileSync(join(src, "workspace", "a.log"), "x");
    const entries = [entry(src, tgt, "workspace")];
    expect(copyAllToMirror(entries, (rel) => rel.endsWith(".log"))).toBe(0);
    rmSync(src, { recursive: true, force: true });
    rmSync(tgt, { recursive: true, force: true });
  });
});
