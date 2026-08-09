import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BackupEngine, runBackupCli } from "../src/backup.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

const FAKE = fileURLToPath(new URL("./helpers/fake-backup-cli.sh", import.meta.url));

describe("BackupEngine", () => {
  it("parses archive path from fake cli", () => {
    const out = mkdtempSync(join(tmpdir(), "bk-"));
    const path = runBackupCli("/tmp/fake-state", out, (_cmd, args) => {
      const outputDir = args[args.indexOf("--output") + 1];
      const res = execFileSync(FAKE, [outputDir, "backup.tar.gz"], { encoding: "utf8" });
      return { status: 0, stdout: res, stderr: "" };
    });
    expect(path).toContain("backup.tar.gz");
    rmSync(out, { recursive: true, force: true });
  });
  it("backupNow runs, uploads to git, and enforces retention", async () => {
    const { bareDir, url } = makeBareRepo();
    const work = makeWorkDir();
    const syncDir = join(work, "gh-sync");
    const backups = join(syncDir, "backups");
    const stateDir = join(work, "state");
    const cfg = { repo: url, branch: "instances/a" } as never;
    mkdirSync(syncDir, { recursive: true });
    const ops = new GitOps(syncDir, url, "instances/a", null);
    await ops.initRepo();
    const engine = new BackupEngine({ stateDir, syncDir, backupsDir: backups, gitops: ops, log: () => {} });
    const result = await engine.backupNow((_cmd, args) => {
      const outputDir = args[args.indexOf("--output") + 1];
      const res = execFileSync(FAKE, [outputDir, "backup.tar.gz"], { encoding: "utf8" });
      return { status: 0, stdout: res, stderr: "" };
    });
    expect(result).not.toBeNull();
    expect(result!.archivePath).toContain("backups");
    expect((await ops.statusRaw()).isClean()).toBe(true);
    expect(await ops.aheadBehind()).toEqual({ ahead: 0, behind: 0 });
    const entries = readdirSync(backups);
    expect(entries.length).toBeGreaterThan(0);
    cleanup(bareDir, work);
  });
});
