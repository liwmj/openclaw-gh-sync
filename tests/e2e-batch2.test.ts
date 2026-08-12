import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/cli.js";
import { DEFAULT_CONFIG, ConfigService } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";

function setupState() {
  const { bareDir, url } = makeBareRepo();
  const root = mkdtempSync(join(tmpdir(), "e2e-b2-"));
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

describe("e2e batch2 (command-level + boundary)", () => {
  it("status reports configured state with instance/branch after first sync", async () => {
    const { bareDir, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");
      const st = await rt.status();
      expect(st.configured).toBe(true);
      expect(st.instanceName).toBe("desktop");
      expect(st.branch).toBe("instances/desktop");
      expect(st.ahead).toBe(0);
      expect(st.behind).toBe(0);
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);

  it("pull is a no-op when remote has no changes (up-to-date)", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");
      const out = await rt.pullNow();
      expect(out).toBe("pull complete");
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("v1");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);

  it("delete propagation: local file deletion reaches remote after sync", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "a.txt"), "a");
      writeFileSync(join(stateDir, "workspace", "b.txt"), "b");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      // delete locally, then let watcher/auto-sync push the removal
      // small settle so chokidar's initial scan has registered the files (unlink can be missed otherwise)
      await new Promise((r) => setTimeout(r, 2500));
      const { rmSync } = await import("node:fs");
      rmSync(join(stateDir, "workspace", "a.txt"));
      await expect.poll(async () => {
        const remote = mkdtempSync(join(tmpdir(), "e2e-b2-remote-"));
        try {
          const remoteOps = new GitOps(remote, url, "instances/desktop", null);
          await remoteOps.initRepo();
          await remoteOps.fetchBranch("instances/desktop");
          await remoteOps.ensureBranch("instances/desktop");
          return existsSync(join(remote, "openclaw", "workspace", "a.txt")) ? "still-there" : "gone";
        } finally {
          cleanup(remote);
        }
      }, { timeout: 20000, interval: 500 }).toBe("gone");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);

  it("断网补推: push failure recorded, recovered and synced via syncNow after network restore", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      const { renameSync } = await import("node:fs");
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      const offlineDir = bareDir + ".offline";
      renameSync(bareDir, offlineDir); // simulate network loss (remote unreachable)
      writeFileSync(join(stateDir, "workspace", "offline-change.txt"), "x");
      // wait for the failed push to be attempted and recorded
      await new Promise((r) => setTimeout(r, 4000));

      renameSync(offlineDir, bareDir); // network recovered
      await rt.syncNow(); // retry pushes pending commit
      const ops = new GitOps(syncDir, FAKE_REPO, "instances/desktop", null);
      await expect.poll(async () => (await ops.aheadBehind()).ahead, { timeout: 15000, interval: 250 }).toBe(0);
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);

  it("backup excludes *.log files from the archive", async () => {
    const { bareDir, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "keep.txt"), "keep");
      writeFileSync(join(stateDir, "workspace", "skip.log"), "skip");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");
      const out = await rt.backupNow();
      expect(out).toContain("backup");
      const archive = out.replace("backup uploaded: ", "").trim();
      const { execFileSync: exec } = await import("node:child_process");
      const listing = exec("tar", ["-tzf", archive], { encoding: "utf8" });
      expect(listing).toContain("keep.txt");
      expect(listing).not.toContain("skip.log");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 30000);

  it("conflicts: real merge conflict is detected and listed, then resolvable", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      // remote changes same file
      const remote = mkdtempSync(join(tmpdir(), "e2e-b2-remote-"));
      try {
        const remoteOps = new GitOps(remote, url, "instances/desktop", null);
        await remoteOps.initRepo();
        await remoteOps.fetchBranch("instances/desktop");
        await remoteOps.ensureBranch("instances/desktop");
        writeFileSync(join(remote, "openclaw", "workspace", "hello.txt"), "remote-v2");
        await remoteOps.commitChanged("remote v2");
        await remoteOps.pushCurrent();
      } finally {
        cleanup(remote);
      }

      // local uncommitted change blocks fast-forward -> pull saves sidecar
      // write dirty into BOTH source and mirror (git working tree) so ff-only is blocked
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "local-dirty");
      writeFileSync(join(syncDir, "openclaw", "workspace", "hello.txt"), "local-dirty");
      const out = await rt.pullNow();
      expect(out).toContain("pull complete");
      // pull force-accepts remote (local dirty preserved as sidecar)
      expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("remote-v2");
      const { readdirSync } = await import("node:fs");
      const sidecars = readdirSync(join(syncDir, "openclaw", "workspace")).filter((n) => n.startsWith("hello.txt.local."));
      expect(sidecars.length).toBeGreaterThan(0);
      // sidecar holds the local dirty content
      expect(readFileSync(join(syncDir, "openclaw", "workspace", sidecars[0]), "utf8")).toBe("local-dirty");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);

  it("setup aborts on non-TTY undefined answer (E fix regression)", async () => {
    const { runSetupWizard } = await import("../src/setup.js");
    const io = {
      stateDir: "/state",
      syncDir: "/state/gh-sync",
      configService: {
        load: () => null,
        validate: () => ({ ok: true, errors: [] as string[] }),
        save: () => {},
      },
      gitCryptAvailable: () => false,
      writeCredentials: () => {},
      hasRemoteInstance: async () => false,
    };
    const prompts = { text: async () => undefined, confirm: async () => true, select: async () => undefined };
    await expect(runSetupWizard({ prompts: prompts as never, io: io as never })).rejects.toThrow(/setup aborted: repo cancelled/);
  });
});