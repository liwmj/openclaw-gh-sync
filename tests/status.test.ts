import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatus } from "../src/status.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("buildStatus", () => {
  it("returns configured=false when no config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-"));
    const status = await buildStatus({
      config: null,
      engine: null,
      gitops: null,
      syncDir: dir,
      gitCrypt: "ok",
      lastBackupAt: null,
      lastError: null,
    });
    expect(status.configured).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns configured=false without throwing when syncDir is absent", async () => {
    const dir = join(tmpdir(), `st-missing-${Date.now()}-${Math.random()}`);
    const status = await buildStatus({
      config: null,
      engine: null,
      gitops: null,
      syncDir: dir,
      gitCrypt: "ok",
      lastBackupAt: null,
      lastError: null,
    });
    expect(status.configured).toBe(false);
    expect(status.conflictFiles).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports ahead/behind 0 when gitops cannot compute them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-"));
    const status = await buildStatus({
      config: { ...DEFAULT_CONFIG, repo: "https://example.com/r.git", branch: "instances/x", instanceName: "x" },
      engine: null,
      gitops: {
        aheadBehind: async () => {
          throw new Error("no remote ref");
        },
        statusRaw: async () => ({ isClean: () => true }),
      },
      syncDir: dir,
      gitCrypt: "ok",
      lastBackupAt: null,
      lastError: null,
    });
    expect(status.configured).toBe(true);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
