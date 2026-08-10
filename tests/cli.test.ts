import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type Runtime, registerCommands } from "../src/cli.js";
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

  it("pushNow and pullNow wrap engine methods", async () => {
    const { root, stateDir, syncDir } = setupState();
    const { bareDir } = makeBareRepo();
    redirectOriginTo(syncDir, bareDir);
    mkdirSync(join(syncDir, "gh-sync.opencfg"), { recursive: true });
    writeFileSync(join(syncDir, "config.json"), JSON.stringify({
      ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop",
    }));
    const rt = createRuntime({ stateDir, env: { ...process.env } });
    await rt.start();
    writeFileSync(join(stateDir, "workspace", "p.txt"), "p");
    expect(await rt.pushNow()).toBe("push complete");
    expect(await rt.pullNow()).toBe("pull complete");
    await rt.stop();
    cleanup(bareDir, root);
  }, 20000);

  it("conflicts returns no conflicts for clean state", async () => {
    const { root, stateDir, syncDir } = setupState();
    const { bareDir } = makeBareRepo();
    redirectOriginTo(syncDir, bareDir);
    mkdirSync(join(syncDir, "gh-sync.opencfg"), { recursive: true });
    writeFileSync(join(syncDir, "config.json"), JSON.stringify({
      ...DEFAULT_CONFIG, repo: FAKE_REPO, branch: "instances/desktop", instanceName: "desktop",
    }));
    const rt = createRuntime({ stateDir, env: { ...process.env } });
    await rt.start();
    expect(await rt.conflicts()).toBe("no conflicts");
    await rt.stop();
    cleanup(bareDir, root);
  }, 20000);
});

describe("registerCommands", () => {
  it("registers all 9 CLI commands under gh-sync", () => {
    const registered: { name: string; desc: string }[] = [];
    function makeCommand(name?: string) {
      return {
        command(cmdName: string) {
          if (!name) return makeCommand(cmdName);
          const child = makeCommand(cmdName);
          return child;
        },
        description(desc: string) {
          if (name) registered.push({ name, desc });
          return this;
        },
        option() { return this; },
        action: () => {},
      };
    }
    const program = { command: () => makeCommand() };
    const rt = {
      status: async () => ({ configured: false } as never),
      syncNow: async () => "",
      pushNow: async () => "",
      pullNow: async () => "",
      backupNow: async () => "",
      restore: async () => "",
      start: async () => {},
      stop: async () => {},
      conflicts: async () => "",
      setup: async () => "",
      reset: async () => "",
    } as Runtime;

    registerCommands(program, rt);

    const names = registered.map((r) => r.name);
    expect(names).toEqual(["status", "push", "pull", "sync", "backup", "restore [snapshot]", "conflicts", "setup", "reset"]);
    expect(registered.every((r) => r.desc.length > 0)).toBe(true);
  });
});
