import { describe, expect, it, vi } from "vitest";
import { planForSetup, runSetupWizard } from "../src/setup.js";
import type { ConfigService } from "../src/config.js";
import type { SyncConfig } from "../src/types.js";

const CANCEL = vi.hoisted(() => Symbol("test-cancel"));

vi.mock("@clack/prompts", () => ({
  isCancel: (v: unknown) => v === CANCEL,
}));

describe("planForSetup", () => {
  it("initializes git-crypt when available", () => {
    const plan = planForSetup({ instanceNameRaw: "My Desktop!", repo: "https://github.com/u/r.git", gitCryptAvailable: true, gitCryptEnabled: true });
    expect(plan.instanceName).toBe("my-desktop");
    expect(plan.branch).toBe("instances/my-desktop");
    expect(plan.gitCryptAction).toBe("init");
  });
  it("skips sensitive sync when git-crypt missing but enabled", () => {
    const plan = planForSetup({ instanceNameRaw: "box", repo: "https://github.com/u/r.git", gitCryptAvailable: false, gitCryptEnabled: true });
    expect(plan.gitCryptAction).toBe("skip-sensitive");
  });
});

describe("runSetupWizard", () => {
  function makePrompts(answers: (string | symbol)[]) {
    const queue = [...answers];
    return {
      text: async () => queue.shift(),
      confirm: async () => true,
      select: async () => queue.shift(),
    };
  }

  function makeIo(overrides: Partial<{ saved: SyncConfig | null; written: string[] }> = {}) {
    const saved: SyncConfig[] = [];
    const written: { file: string; repo: string; pat: string }[] = [];
    return {
      io: {
        stateDir: "/state",
        configService: {
          validate: (raw: unknown) => {
            if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["config is not an object"] };
            const cfg = raw as Partial<SyncConfig>;
            const errors: string[] = [];
            if (typeof cfg.repo !== "string" || !/^https:\/\/github\.com\/.+/.test(cfg.repo)) errors.push("repo must be an https GitHub URL");
            if (typeof cfg.instanceName !== "string" || !/^[a-z0-9-]+$/.test(cfg.instanceName)) errors.push("instanceName must match [a-z0-9-]");
            if (typeof cfg.branch !== "string" || !cfg.branch.startsWith("instances/")) errors.push("branch must start with instances/");
            if (typeof cfg.pollIntervalSec !== "number" || cfg.pollIntervalSec < 5) errors.push("pollIntervalSec >= 5");
            if (typeof cfg.backupIntervalH !== "number" || cfg.backupIntervalH < 1) errors.push("backupIntervalH >= 1");
            return { ok: errors.length === 0, errors };
          },
          save: (c: SyncConfig) => saved.push(c),
        } as unknown as ConfigService,
        gitCryptAvailable: () => false,
        writeCredentials: (file: string, repo: string, pat: string) => written.push({ file, repo, pat }),
      },
      saved,
      written,
    };
  }

  it("aborts when repo prompt is cancelled without saving anything", async () => {
    const { io, saved, written } = makeIo();
    await expect(runSetupWizard({ prompts: makePrompts([CANCEL]), io })).rejects.toThrow("setup aborted: repo cancelled");
    expect(saved).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  it("aborts when PAT prompt is cancelled", async () => {
    const { io } = makeIo();
    await expect(runSetupWizard({ prompts: makePrompts(["https://github.com/u/r.git", CANCEL]), io })).rejects.toThrow("setup aborted: PAT cancelled");
  });

  it("aborts when instance name prompt is cancelled", async () => {
    const { io } = makeIo();
    await expect(runSetupWizard({ prompts: makePrompts(["https://github.com/u/r.git", "pat", CANCEL]), io })).rejects.toThrow("setup aborted: instance name cancelled");
  });

  it("validates config before saving and refuses an invalid repo", async () => {
    const { io, saved, written } = makeIo();
    await expect(runSetupWizard({ prompts: makePrompts(["https://github.com/", "pat", "box"]), io })).rejects.toThrow(/setup aborted: invalid config/);
    expect(saved).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  it("writes credentials under the gh-sync credentials path and returns a validated config", async () => {
    const { io, saved, written } = makeIo();
    const cfg = await runSetupWizard({ prompts: makePrompts(["https://github.com/u/r.git", "pat-123", "Box"]), io });
    expect(saved).toHaveLength(1);
    expect(cfg.repo).toBe("https://github.com/u/r.git");
    expect(cfg.branch).toBe("instances/box");
    expect(cfg.instanceName).toBe("box");
    expect(written).toEqual([{ file: "/state/gh-sync/.git-credentials", repo: "https://github.com/u/r.git", pat: "pat-123" }]);
  });
});
