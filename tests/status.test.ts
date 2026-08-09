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
});
