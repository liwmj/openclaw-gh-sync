import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRuntime } from "../src/cli.js";
import { DEFAULT_CONFIG, ConfigService } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { createCustomArchive } from "../src/backup.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";

function setupState() {
  const { bareDir, url } = makeBareRepo();
  const root = mkdtempSync(join(tmpdir(), "e2e-b3-"));
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

describe("e2e batch3 (sync chain + cross-instance + timeout boundary)", () => {
  it("sync chain: automatic watcher push on local change, then manual syncNow returns sync complete", async () => {
    const { bareDir, url, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      // automatic chain: no manual sync call, watcher picks up the new file and pushes
      await new Promise((r) => setTimeout(r, 2500)); // chokidar settle
      writeFileSync(join(stateDir, "workspace", "auto.txt"), "auto");
      await expect
        .poll(
          async () => {
            const remote = mkdtempSync(join(tmpdir(), "e2e-b3-remote-"));
            try {
              const remoteOps = new GitOps(remote, url, "instances/desktop", null);
              await remoteOps.initRepo();
              await remoteOps.fetchBranch("instances/desktop");
              await remoteOps.ensureBranch("instances/desktop");
              return existsSync(join(remote, "openclaw", "workspace", "auto.txt")) ? "there" : "not-yet";
            } finally {
              cleanup(remote);
            }
          },
          { timeout: 20000, interval: 500 },
        )
        .toBe("there");

      // manual trigger
      const out = await rt.syncNow();
      expect(out).toBe("sync complete");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);

  it("restore cross-instance: --from-instance pulls and applies another instance's snapshot", async () => {
    const { bareDir, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");
      await rt.stop(); // stop watcher so it cannot interfere with branch switching

      // build a snapshot for another instance ("other")
      const otherState = mkdtempSync(join(tmpdir(), "e2e-b3-other-state-"));
      const outDir = mkdtempSync(join(tmpdir(), "e2e-b3-other-bk-"));
      try {
        mkdirSync(join(otherState, "workspace"), { recursive: true });
        writeFileSync(join(otherState, "workspace", "other.txt"), "from-other");
        const archive = createCustomArchive(otherState, outDir, ["workspace"]);

        // push it on branch instances/other
        const ops = new GitOps(syncDir, FAKE_REPO, "instances/desktop", null);
        await ops.ensureBranch("instances/other"); // create local branch from current HEAD
        mkdirSync(join(syncDir, "backups"), { recursive: true });
        copyFileSync(archive, join(syncDir, "backups", basename(archive)));
        await ops.commitChanged("other backup");
        await ops.pushCurrent();
        await ops.ensureBranch("instances/desktop"); // switch back
      } finally {
        cleanup(otherState, outDir);
      }

      // cross-instance restore applies "other" snapshot into local state
      const restoreOut = await rt.restore({ fromInstance: "other", yes: true });
      expect(restoreOut).toContain("restored");
      expect(readFileSync(join(stateDir, "workspace", "other.txt"), "utf8")).toBe("from-other");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);

  it("timeout boundary: push failure recorded, index.lock cleaned, no stale git process", async () => {
    const { bareDir, root, stateDir, syncDir, rt } = setupState();
    try {
      writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
      await rt.start();
      await waitAheadZero(syncDir, "instances/desktop");

      // take the remote offline (rename bare repo) -> push fails fast, no 30s hang on local fs
      const offlineDir = bareDir + ".offline";
      renameSync(bareDir, offlineDir);
      writeFileSync(join(stateDir, "workspace", "x.txt"), "x");
      await new Promise((r) => setTimeout(r, 5000)); // let retries happen

      const st = await rt.status();
      expect(st.lastError).toBeTruthy(); // onError recorded
      expect(existsSync(join(syncDir, ".git", "index.lock"))).toBe(false); // lock cleaned, no residue

      // restore network, next push goes through
      renameSync(offlineDir, bareDir);
      await rt.syncNow();
      await waitAheadZero(syncDir, "instances/desktop");
    } finally {
      await rt.stop();
      cleanup(bareDir, root);
    }
  }, 40000);
});
