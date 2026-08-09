import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWatcher } from "../src/watcher.js";

describe("FileWatcher", () => {
  it("fires onChange with changed paths after debounce", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w-"));
    const changed: string[][] = [];
    const watcher = new FileWatcher([dir], [], (paths) => changed.push(paths));
    watcher.start();
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(join(dir, "a.txt"), "hi");
    await new Promise((r) => setTimeout(r, 3000));
    watcher.stop();
    expect(changed.length).toBeGreaterThan(0);
    expect(changed[0].some((p) => p.includes("a.txt"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
