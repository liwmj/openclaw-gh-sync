import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAllToMirror, copyMirrorToSources, fileEq } from "../src/mirror.js";
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
  it("fileEq distinguishes byte-distinct binary content", () => {
    const a = join(tmpdir(), `feq-a-${Date.now()}.bin`);
    const b = join(tmpdir(), `feq-b-${Date.now()}.bin`);
    const ta = new Date("2020-01-01T00:00:00Z");
    const tb = new Date("2020-01-02T00:00:00Z");
    writeFileSync(a, Buffer.from([0xff]));
    writeFileSync(b, Buffer.from([0xfe]));
    utimesSync(a, ta, ta);
    utimesSync(b, tb, tb);
    expect(fileEq(a, b)).toBe(false);
    rmSync(a, { force: true });
    rmSync(b, { force: true });
  });
});
