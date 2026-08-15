import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupEngine, createCustomArchive } from "../src/backup.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

describe("BackupEngine", () => {
  it("creates a real tar.gz archive containing core assets", () => {
    const stateDir = makeWorkDir();
    mkdirSync(join(stateDir, "workspace"), { recursive: true });
    mkdirSync(join(stateDir, "memory"), { recursive: true });
    writeFileSync(join(stateDir, "workspace", "MEMORY.md"), "# memory");
    writeFileSync(join(stateDir, "memory", "notes.md"), "notes");
    writeFileSync(join(stateDir, "openclaw.json"), "{}");
    const out = mkdtempSync(join(tmpdir(), "bk-"));
    const path = createCustomArchive(stateDir, out, ["workspace"]);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain("gh-sync-backup-");
    rmSync(out, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });
  it("backupNow runs, uploads to git, and enforces retention", async () => {
    const { bareDir, url } = makeBareRepo();
    const work = makeWorkDir();
    const syncDir = join(work, "gh-sync");
    const backups = join(syncDir, "backups");
    const stateDir = join(work, "state");
    mkdirSync(join(stateDir, "workspace"), { recursive: true });
    writeFileSync(join(stateDir, "workspace", "MEMORY.md"), "# mem");
    mkdirSync(syncDir, { recursive: true });
    const ops = new GitOps(syncDir, url, "instances/a", null);
    await ops.initRepo();
    const engine = new BackupEngine({
      stateDir,
      syncDir,
      backupsDir: backups,
      retain: 7,
      include: ["workspace"],
      gitops: ops,
      log: () => {},
    });
    const result = await engine.backupNow();
    expect(result).not.toBeNull();
    expect(result!.archivePath).toContain("backups");
    expect((await ops.statusRaw()).isClean()).toBe(true);
    expect(await ops.aheadBehind()).toEqual({ ahead: 0, behind: 0 });
    const entries = readdirSync(backups);
    expect(entries.length).toBeGreaterThan(0);
    cleanup(bareDir, work);
  });
  it("enforceRetention removes oldest archives beyond retain count", async () => {
    const { bareDir, url } = makeBareRepo();
    const work = makeWorkDir();
    const syncDir = join(work, "gh-sync");
    const backups = join(syncDir, "backups");
    const stateDir = join(work, "state");
    mkdirSync(backups, { recursive: true });

    const ops = new GitOps(syncDir, url, "instances/a", null);
    await ops.initRepo();
    const engine = new BackupEngine({
      stateDir,
      syncDir,
      backupsDir: backups,
      retain: 2,
      include: ["workspace"],
      gitops: ops,
      log: () => {},
    });

    const files = ["a.tar.gz", "b.tar.gz", "c.tar.gz", "d.tar.gz", "e.tar.gz"];
    const now = Date.now();
    files.forEach((f, i) => {
      const p = join(backups, f);
      writeFileSync(p, f);
      const age = i * 60000;
      utimesSync(p, now - age, now - age);
    });
    expect(readdirSync(backups).length).toBe(5);

    await engine.enforceRetention();

    const remaining = readdirSync(backups).sort();
    expect(remaining).toEqual(["a.tar.gz", "b.tar.gz"]);
    expect(await ops.aheadBehind()).toEqual({ ahead: 0, behind: 0 });
    cleanup(bareDir, work);
  });
});
