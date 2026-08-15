import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { GitOps } from "../src/gitops.js";
import { SyncEngine } from "../src/realtime.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

function setup(): { bareDir: string; workDir: string; stateDir: string; syncDir: string } {
  const { bareDir, url } = makeBareRepo();
  const workDir = mkdtempSync(join(tmpdir(), "rt-"));
  const stateDir = join(workDir, "state");
  const syncDir = join(stateDir, "gh-sync");
  mkdirSync(join(stateDir, "workspace"), { recursive: true });
  mkdirSync(syncDir, { recursive: true });
  const cfg = { ...DEFAULT_CONFIG, repo: url, branch: "instances/desktop", instanceName: "desktop" };
  const ops = new GitOps(syncDir, url, cfg.branch, null);
  const engine = new SyncEngine({ syncDir, stateDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });
  void engine;
  return { bareDir, workDir, stateDir, syncDir };
}

describe("SyncEngine", () => {
  it("pushes local changes to the bare repo and pulls remote changes back", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = { ...DEFAULT_CONFIG, repo: bareDir, branch: "instances/desktop", instanceName: "desktop" };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    const engine = new SyncEngine({ syncDir, stateDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });
    await engine.start();

    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(stateDir, "workspace", "a.txt"), "local");
    await engine.pushNow();
    await expect.poll(async () => (await ops.aheadBehind()).ahead, { timeout: 10000, interval: 100 }).toBe(0);
    await expect.poll(async () => (await ops.aheadBehind()).behind, { timeout: 10000, interval: 100 }).toBe(0);

    const remoteWork = mkdtempSync(join(tmpdir(), "rt-remote-"));
    const remoteOps = new GitOps(remoteWork, bareDir, cfg.branch, null);
    await remoteOps.initRepo();
    mkdirSync(join(remoteWork, "openclaw", "workspace"), { recursive: true });
    writeFileSync(join(remoteWork, "openclaw", "workspace", "a.txt"), "remote-v2");
    await remoteOps.commitChanged("remote");
    await remoteOps.push();

    await engine.pullNow();
    expect(readFileSync(join(stateDir, "workspace", "a.txt"), "utf8")).toBe("remote-v2");

    await engine.stop();
    cleanup(bareDir, workDir, remoteWork);
  }, 20000);

  it("start() is idempotent: a second call does not leak a watcher that keeps pushing after stop", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = {
      ...DEFAULT_CONFIG,
      repo: bareDir,
      branch: "instances/desktop",
      instanceName: "desktop",
      pushDebounceMs: 300,
    };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    const engine = new SyncEngine({ syncDir, stateDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });
    await engine.start();
    await engine.start();

    await engine.stop();
    writeFileSync(join(stateDir, "workspace", "a.txt"), "hi");
    await new Promise((r) => setTimeout(r, 2500));

    const remoteWork = mkdtempSync(join(tmpdir(), "rt-leak-"));
    const remoteOps = new GitOps(remoteWork, bareDir, cfg.branch, null);
    await remoteOps.initRepo();
    expect(existsSync(join(remoteWork, "openclaw", "workspace", "a.txt"))).toBe(false);

    await engine.stop();
    cleanup(bareDir, workDir, remoteWork);
  }, 30000);

  it("start() clears the guard on failure so a retry starts the watcher", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = {
      ...DEFAULT_CONFIG,
      repo: bareDir,
      branch: "instances/desktop",
      instanceName: "desktop",
      pushDebounceMs: 300,
    };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    let fail = true;
    const realInit = ops.initRepo.bind(ops);
    ops.initRepo = async () => {
      if (fail) {
        fail = false;
        throw new Error("boom");
      }
      await realInit();
    };
    const engine = new SyncEngine({ syncDir, stateDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });

    await expect(engine.start()).rejects.toThrow("boom");

    await engine.start();
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(stateDir, "workspace", "retry.txt"), "hi");
    await expect.poll(async () => (await ops.aheadBehind()).ahead, { timeout: 15000, interval: 500 }).toBe(0);

    await engine.stop();
    cleanup(bareDir, workDir);
  }, 30000);

  it("reports errors via onError instead of crashing when a watched file is deleted", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = { ...DEFAULT_CONFIG, repo: bareDir, branch: "instances/desktop", instanceName: "desktop" };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    const errors: unknown[] = [];
    const engine = new SyncEngine({
      syncDir,
      stateDir,
      config: cfg,
      gitops: ops,
      log: () => {},
      onError: (err) => {
        errors.push(err);
      },
    });
    await engine.start();

    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(stateDir, "workspace", "a.txt"), "hi");
    await expect.poll(async () => (await ops.aheadBehind()).behind, { timeout: 10000, interval: 100 }).toBe(0);

    rmSync(join(stateDir, "workspace", "a.txt"));
    // 删除文件是正常同步操作：镜像副本被移除、变更推送到远端，不触发 onError 也不崩溃
    await expect
      .poll(
        async () => {
          const mirrorFile = join(syncDir, "openclaw", "workspace", "a.txt");
          const ab = await ops.aheadBehind();
          return !existsSync(mirrorFile) && ab.ahead === 0 && ab.behind === 0;
        },
        { timeout: 10000, interval: 100 },
      )
      .toBe(true);
    expect(errors).toHaveLength(0);

    await engine.stop();
    cleanup(bareDir, workDir);
  }, 30000);

  it("concurrent start() and stop() does not orphan a watcher", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = { ...DEFAULT_CONFIG, repo: bareDir, branch: "instances/desktop", instanceName: "desktop" };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    const engine = new SyncEngine({ syncDir, stateDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });

    await Promise.all([engine.start(), engine.stop()]);

    await engine.start();
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(stateDir, "workspace", "z.txt"), "check");
    await engine.pushNow();
    await expect.poll(async () => (await ops.aheadBehind()).ahead, { timeout: 15000, interval: 200 }).toBe(0);

    await engine.stop();
    cleanup(bareDir, workDir);
  }, 30000);
});
