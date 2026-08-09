import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/cli.js";
import { DEFAULT_CONFIG, ConfigService } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";
const FAKE_BACKUP_CLI = fileURLToPath(new URL("./helpers/fake-backup-cli.sh", import.meta.url));

describe("e2e", () => {
  it("full lifecycle: setup-config → start → push → remote pull → backup → restore preview", async () => {
    const { bareDir, url } = makeBareRepo();
    const root = mkdtempSync(join(tmpdir(), "e2e-"));
    const stateDir = join(root, "state");
    const syncDir = join(stateDir, "gh-sync");
    mkdirSync(join(stateDir, "workspace"), { recursive: true });
    execFileSync("git", ["init", syncDir], { stdio: "ignore" });
    execFileSync("git", ["-C", syncDir, "config", `url.${bareDir}.insteadOf`, FAKE_REPO]);

    const cfgService = new ConfigService(join(syncDir, "config.json"));
    cfgService.save({ ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop" });

    const prevBackupCli = process.env.GH_SYNC_BACKUP_CLI;
    process.env.GH_SYNC_BACKUP_CLI = FAKE_BACKUP_CLI;
    try {
      const rt = createRuntime({ stateDir, env: { ...process.env } });
      await rt.start();

      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.syncNow();
      const localOps = new GitOps(syncDir, FAKE_REPO, "instances/desktop", null);
      await expect.poll(async () => (await localOps.aheadBehind()).ahead, { timeout: 10000, interval: 250 }).toBe(0);

      const remote = mkdtempSync(join(tmpdir(), "e2e-remote-"));
      const remoteOps = new GitOps(remote, url, "instances/desktop", null);
      await remoteOps.initRepo();
      mkdirSync(join(remote, "openclaw", "workspace"), { recursive: true });
      writeFileSync(join(remote, "openclaw", "workspace", "hello.txt"), "remote");
      await remoteOps.commitChanged("remote");
      await remoteOps.push();

      await rt.syncNow();
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("remote");

      const backupOut = await rt.backupNow();
      expect(backupOut).toContain("backup");

      const restoreOut = await rt.restore({ dryRun: true });
      expect(restoreOut).toContain("preview");

      await rt.stop();
      cleanup(bareDir, root, remote);
    } finally {
      process.env.GH_SYNC_BACKUP_CLI = prevBackupCli;
    }
  }, 30000);
});
