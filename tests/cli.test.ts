import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type Runtime } from "../src/cli.js";
import { DEFAULT_CONFIG, ConfigService } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";

function setupState(): { root: string; stateDir: string; syncDir: string } {
  const root = mkdtempSync(join(tmpdir(), "cli-"));
  const stateDir = join(root, "state");
  const syncDir = join(stateDir, "gh-sync");
  mkdirSync(join(stateDir, "workspace"), { recursive: true });
  mkdirSync(syncDir, { recursive: true });
  return { root, stateDir, syncDir };
}

function redirectOriginTo(syncDir: string, bareDir: string): void {
  execFileSync("git", ["init", syncDir], { stdio: "ignore" });
  execFileSync("git", ["-C", syncDir, "config", `url.${bareDir}.insteadOf`, FAKE_REPO]);
}

describe("CLI runtime", () => {
  it("is unconfigured before setup", async () => {
    const rt: Runtime = createRuntime({ stateDir: "/tmp/none", env: {} });
    const status = await rt.status();
    expect(status.configured).toBe(false);
  });

  it("stop() tears down the engine so no orphaned watcher pushes after stop", async () => {
    const { bareDir } = makeBareRepo();
    const { root, stateDir, syncDir } = setupState();
    redirectOriginTo(syncDir, bareDir);

    const cfgService = new ConfigService(join(syncDir, "config.json"));
    cfgService.save({ ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop", pushDebounceMs: 300 });

    const rt = createRuntime({ stateDir, env: { ...process.env } });
    await rt.start();
    await rt.syncNow();
    await rt.stop();

    writeFileSync(join(stateDir, "workspace", "after-stop.txt"), "v1");
    await new Promise((r) => setTimeout(r, 2500));

    const remoteWork = mkdtempSync(join(tmpdir(), "cli-remote-"));
    const remoteOps = new GitOps(remoteWork, bareDir, "instances/desktop", null);
    await remoteOps.initRepo();
    expect(existsSync(join(remoteWork, "openclaw", "workspace", "after-stop.txt"))).toBe(false);

    await rt.stop();
    cleanup(bareDir, root, remoteWork);
  }, 20000);

  it("does not stamp a backup timestamp when the backup fails", async () => {
    const { bareDir } = makeBareRepo();
    const { root, stateDir, syncDir } = setupState();
    redirectOriginTo(syncDir, bareDir);

    const cfgService = new ConfigService(join(syncDir, "config.json"));
    cfgService.save({ ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop" });

    const binDir = mkdtempSync(join(tmpdir(), "cli-bin-"));
    writeFileSync(join(binDir, "openclaw"), "#!/bin/sh\necho '{\"archive\": \"/nonexistent/backup.tar.gz\"}'\n", { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    try {
      const rt = createRuntime({ stateDir, env: { ...process.env } });
      const out = await rt.backupNow();
      expect(out).toBe("backup failed");
      expect((await rt.status()).lastBackupAt).toBeNull();
      await rt.stop();
    } finally {
      process.env.PATH = prevPath;
      cleanup(bareDir, root, binDir);
    }
  }, 20000);
});
