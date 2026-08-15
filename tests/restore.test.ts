import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSnapshots, RestoreEngine, walkForPreview } from "../src/restore.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

describe("restore", () => {
  it("lists tar.gz snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    writeFileSync(join(dir, "a.tar.gz"), "");
    writeFileSync(join(dir, "b.txt"), "");
    expect(listSnapshots(dir)).toEqual(["a.tar.gz"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not follow symlinks during preview walk", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    const outside = join(dir, "outside");
    const inside = join(dir, "inside");
    mkdirSync(outside, { recursive: true });
    mkdirSync(inside, { recursive: true });
    writeFileSync(join(outside, "leak.txt"), "outside");
    writeFileSync(join(inside, "safe.txt"), "inside");
    symlinkSync(outside, join(inside, "link"));
    const paths = walkForPreview(inside);
    const names = paths.map((p) => p.replace(inside + "/", ""));
    expect(names).toContain("link");
    expect(names).toContain("safe.txt");
    expect(names).not.toContain("leak.txt");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the remote instance branch does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    const engine = new RestoreEngine({
      syncDir: dir,
      stateDir: dir,
      ownBranch: "main",
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
      ownBranch: "main",
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

  it("applies a snapshot without destroying the repo and persists via push", async () => {
    const { bareDir, url } = makeBareRepo();
    const stateDir = mkdtempSync(join(tmpdir(), "rs-state-"));
    const syncDir = join(stateDir, "gh-sync");
    mkdirSync(syncDir, { recursive: true });
    const ops = new GitOps(syncDir, url, "main", null);
    await ops.initRepo();
    mkdirSync(join(syncDir, "backups"), { recursive: true });
    const snapRoot = mkdtempSync(join(tmpdir(), "rs-snap-"));
    mkdirSync(join(snapRoot, "gh-sync", "openclaw"), { recursive: true });
    writeFileSync(join(snapRoot, "gh-sync", "openclaw", "restored.txt"), "restored");
    const snapshot = join(syncDir, "backups", "snap.tar.gz");
    const packed = spawnSync("tar", ["-czf", snapshot, "-C", snapRoot, "gh-sync"], { encoding: "utf8" });
    expect(packed.status).toBe(0);
    const binDir = mkdtempSync(join(tmpdir(), "rs-bin-"));
    writeFileSync(join(binDir, "openclaw"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const prevPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${prevPath ?? ""}`;
      const engine = new RestoreEngine({
        syncDir,
        stateDir,
        ownBranch: "main",
        gitops: ops,
        log: () => {},
      });
      const result = await engine.restore({ snapshot: "snap.tar.gz", yes: true });
      expect(result.applied).toBe(true);
      expect(existsSync(join(stateDir, "gh-sync", "openclaw", "restored.txt"))).toBe(true);
      expect(await ops.cleanWorkingTree()).toBe(true);
      expect(await ops.fetch()).toBe(true);
      expect(await ops.aheadBehind()).toEqual({ ahead: 0, behind: 0 });
    } finally {
      if (prevPath !== undefined) process.env.PATH = prevPath;
      else delete process.env.PATH;
      cleanup(bareDir, stateDir, snapRoot, binDir);
    }
  });

  it("does not throw when push fails after restore — state is already applied", async () => {
    const { bareDir, url } = makeBareRepo();
    const stateDir = mkdtempSync(join(tmpdir(), "rs-state-"));
    const syncDir = join(stateDir, "gh-sync");
    mkdirSync(syncDir, { recursive: true });
    const ops = new GitOps(syncDir, url, "main", null);
    await ops.initRepo();
    mkdirSync(join(syncDir, "backups"), { recursive: true });
    const snapRoot = mkdtempSync(join(tmpdir(), "rs-snap-"));
    mkdirSync(join(snapRoot, "gh-sync", "openclaw"), { recursive: true });
    writeFileSync(join(snapRoot, "gh-sync", "openclaw", "x.txt"), "ok");
    const snapshot = join(syncDir, "backups", "push-fail.tar.gz");
    expect(spawnSync("tar", ["-czf", snapshot, "-C", snapRoot, "gh-sync"]).status).toBe(0);
    const binDir = mkdtempSync(join(tmpdir(), "rs-bin-"));
    writeFileSync(join(binDir, "openclaw"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const logs: string[] = [];
    const prevPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${prevPath ?? ""}`;
      const engine = new RestoreEngine({
        syncDir,
        stateDir,
        gitops: {
          ensureBranch: (name: string) => ops.ensureBranch(name),
          fetchBranch: (branch: string) => ops.fetchBranch(branch),
          commitChanged: (message: string) => ops.commitChanged(message),
          pushCurrent: async () => {
            throw new Error("network down");
          },
        },
        log: (m) => logs.push(m),
      });
      const result = await engine.restore({ snapshot: "push-fail.tar.gz", yes: true });
      expect(result.applied).toBe(true);
      expect(existsSync(join(stateDir, "gh-sync", "openclaw", "x.txt"))).toBe(true);
      expect(logs.some((m) => m.includes("push failed"))).toBe(true);
    } finally {
      if (prevPath !== undefined) process.env.PATH = prevPath;
      else delete process.env.PATH;
      cleanup(bareDir, stateDir, snapRoot, binDir);
    }
  });

  it("throws original error when fetchBranch fails due to network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    const engine = new RestoreEngine({
      syncDir: dir,
      stateDir: dir,
      ownBranch: "main",
      gitops: {
        ensureBranch: async () => {},
        fetchBranch: async () => {
          throw new Error("network unreachable");
        },
        commitChanged: async () => true,
        pushCurrent: async () => {},
      },
      log: () => {},
    });
    await expect(engine.restore({ fromInstance: "dev", yes: true })).rejects.toThrow("network unreachable");
    rmSync(dir, { recursive: true, force: true });
  });
});
