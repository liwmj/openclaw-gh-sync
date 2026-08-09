import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSnapshots, RestoreEngine } from "../src/restore.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

describe("restore", () => {
  it("lists tar.gz snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    writeFileSync(join(dir, "a.tar.gz"), "");
    writeFileSync(join(dir, "b.txt"), "");
    expect(listSnapshots(dir)).toEqual(["a.tar.gz"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the remote instance branch does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    const engine = new RestoreEngine({
      syncDir: dir,
      stateDir: dir,
      gitops: {
        ensureBranch: async () => {},
        fetchBranch: async () => false,
        commitChanged: async () => true,
        pushCurrent: async () => {},
      },
      log: () => {},
    });
    await expect(engine.restore({ fromInstance: "missing", yes: true })).rejects.toThrow("no remote instance: missing");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the instance branch has no snapshots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    const engine = new RestoreEngine({
      syncDir: dir,
      stateDir: dir,
      gitops: {
        ensureBranch: async () => {},
        fetchBranch: async () => true,
        commitChanged: async () => true,
        pushCurrent: async () => {},
      },
      log: () => {},
    });
    await expect(engine.restore({ fromInstance: "dev", yes: true })).rejects.toThrow("no snapshot available");
    rmSync(dir, { recursive: true, force: true });
  });
});
