import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/cli.js";
import { DEFAULT_CONFIG, ConfigService } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";

function setupState() {
  const { bareDir, url } = makeBareRepo();
  const root = mkdtempSync(join(tmpdir(), "e2e-cov-"));
  const stateDir = join(root, "state");
  const syncDir = join(stateDir, "gh-sync");
  mkdirSync(join(stateDir, "workspace"), { recursive: true });
  execFileSync("git", ["init", syncDir], { stdio: "ignore" });
  execFileSync("git", ["-C", syncDir, "config", `url.${bareDir}.insteadOf`, FAKE_REPO]);
  const cfgService = new ConfigService(join(syncDir, "config.json"));
  cfgService.save({ ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop" });
  const rt = createRuntime({ stateDir, env: { ...process.env } });
  return { bareDir, url, root, stateDir, syncDir, rt };
}

async function waitAheadZero(syncDir: string, branch: string, timeout = 15000) {
  const ops = new GitOps(syncDir, FAKE_REPO, branch, null);
  await expect.poll(async () => (await ops.aheadBehind()).ahead, { timeout, interval: 250 }).toBe(0);
}

describe("e2e coverage", () => {
  it("empty-remote first sync (merge): local files pushed to empty remote, no conflict", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      // write local file BEFORE start so first sync pushes it (mirror copy happens in start())
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      const remote = mkdtempSync(join(tmpdir(), "e2e-cov-remote-"));
      try {
        const remoteOps = new GitOps(remote, url, "instances/desktop", null);
        await remoteOps.initRepo();
        expect(await remoteOps.fetchBranch("instances/desktop")).toBe(true);
        await remoteOps.ensureBranch("instances/desktop");
        expect(readFileSync(join(remote, "openclaw", "workspace", "hello.txt"), "utf8")).toBe("v1");
      } finally {
        cleanup(remote);
      }
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);

  it("reset replaces local dirty state with remote data and backs up old files", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    const preResetBackups = readdirSync(tmpdir()).filter((n) => n.startsWith("gh-sync-reset-")).length;
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      // remote moves ahead to v2
      const remote = mkdtempSync(join(tmpdir(), "e2e-cov-remote-"));
      try {
        const remoteOps = new GitOps(remote, url, "instances/desktop", null);
        await remoteOps.initRepo();
        await remoteOps.fetchBranch("instances/desktop");
        await remoteOps.ensureBranch("instances/desktop");
        writeFileSync(join(remote, "openclaw", "workspace", "hello.txt"), "v2");
        await remoteOps.commitChanged("remote v2");
        await remoteOps.pushCurrent();
      } finally {
        cleanup(remote);
      }

      // local dirty state that must be wiped by reset
      writeFileSync(join(stateDir, "workspace", "dirty.txt"), "local-dirty");
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("v1");

      const out = await rt.reset();
      expect(out).toContain("replaced");
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("v2");
      expect(existsSync(join(stateDir, "workspace", "dirty.txt"))).toBe(false);

      const afterBackups = readdirSync(tmpdir()).filter((n) => n.startsWith("gh-sync-reset-")).length;
      expect(afterBackups).toBeGreaterThan(preResetBackups);
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);

  it("restore applies a real snapshot (non-dry-run) replacing local dirty state", async () => {
    const { bareDir, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");
      const backupOut = await rt.backupNow();
      expect(backupOut).toContain("backup");

      // corrupt local state after snapshot, then restore for real
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "corrupted");
      const restoreOut = await rt.restore({ yes: true });
      expect(restoreOut).toContain("restored");
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("v1");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);
});
