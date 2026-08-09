import { isCancel } from "@clack/prompts";
import { sanitizeInstanceName, type ConfigService } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { credentialsPath, ghSyncDir } from "./paths.js";
import { gitCryptInit, writeGitattributes, SENSITIVE_GLOBS } from "./gitcrypt.js";
import type { SyncConfig } from "./types.js";

export interface SetupPlan {
  instanceName: string;
  branch: string;
  gitCryptAction: "init" | "skip-sensitive" | "none";
}

export function planForSetup(input: {
  instanceNameRaw: string;
  repo: string;
  gitCryptAvailable: boolean;
  gitCryptEnabled: boolean;
}): SetupPlan {
  const instanceName = sanitizeInstanceName(input.instanceNameRaw) || "default";
  const branch = `instances/${instanceName}`;
  let gitCryptAction: SetupPlan["gitCryptAction"] = "none";
  if (input.gitCryptEnabled) {
    gitCryptAction = input.gitCryptAvailable ? "init" : "skip-sensitive";
  }
  return { instanceName, branch, gitCryptAction };
}

export const GIT_CRYPT_INSTALL_HINT =
  "git-crypt is required to encrypt auth/credentials/channels and backup archives.\n" +
  "macOS:  brew install git-crypt\n" +
  "Debian/Ubuntu:  sudo apt install git-crypt\n" +
  "Run setup again after installing, or continue in degraded mode (sensitive paths stay plaintext).";

export async function runSetupWizard(opts: {
  prompts: Pick<typeof import("@clack/prompts"), "text" | "confirm" | "select">;
  io: {
    stateDir: string;
    syncDir: string;
    configService: ConfigService;
    gitCryptAvailable: () => boolean;
    writeCredentials: (file: string, repo: string, pat: string) => void;
    hasRemoteInstance: (repo: string, branch: string) => Promise<boolean>;
  };
}): Promise<SyncConfig> {
  const { prompts, io } = opts;

  const abort = (what: string): never => {
    throw new Error(`setup aborted: ${what} cancelled`);
  };

  const repoRes = await prompts.text({ message: "GitHub repository (username/repo or https://github.com/username/repo)" });
  if (isCancel(repoRes)) abort("repo");
  const patRes = await prompts.text({ message: "GitHub Personal Access Token (Fine-grained: Contents=Read+Write, or Classic: repo scope)" });
  if (isCancel(patRes)) abort("PAT");
  const instanceNameRawRes = await prompts.text({ message: "Instance name" });
  if (isCancel(instanceNameRawRes)) abort("instance name");
  const pat = String(patRes);
  const instanceNameRaw = String(instanceNameRawRes);
  let rawRepo = String(repoRes);
  if (!/^https?:\/\//.test(rawRepo)) {
    rawRepo = `https://github.com/${rawRepo.replace(/^\/+/, "")}`;
  }
  const repo = rawRepo;

  const gitCryptRes = await prompts.confirm({
    message: "Enable git-crypt encryption for sensitive files? (recommended if all devices have git-crypt)",
  });
  const wantsGitCrypt = !isCancel(gitCryptRes) && gitCryptRes === true;

  const plan = planForSetup({
    instanceNameRaw,
    repo,
    gitCryptAvailable: io.gitCryptAvailable(),
    gitCryptEnabled: wantsGitCrypt,
  });

  let syncStrategy: SyncConfig["syncStrategy"] = "merge";
  const hasRemote = await io.hasRemoteInstance(repo, plan.branch).catch(() => false);
  if (hasRemote) {
    const strategyRes = await prompts.select({
      message: `Remote already has data for instance "${plan.instanceName}". How should sync handle it?`,
      options: [
        { value: "merge", label: "Merge — combine local and remote data (recommended)" },
        { value: "replace-local", label: "Replace local — overwrite local with remote (use when migrating)" },
      ],
    });
    if (isCancel(strategyRes)) abort("strategy selection");
    syncStrategy = strategyRes as SyncConfig["syncStrategy"];
  }

  let action: SetupPlan["gitCryptAction"] = plan.gitCryptAction;
  if (action === "skip-sensitive") {
    console.log(GIT_CRYPT_INSTALL_HINT);
    const choiceRes = await prompts.select({
      message: "git-crypt is missing. How do you want to proceed?",
      options: [
        { value: "init", label: "Install hint — I'll install git-crypt (brew/apt), proceed" },
        { value: "degraded", label: "Degraded mode — sensitive paths stay plaintext" },
        { value: "abort", label: "Abort setup" },
      ],
    });
    if (isCancel(choiceRes)) abort("git-crypt choice");
    const choice = choiceRes as "init" | "degraded" | "abort";
    if (choice === "abort") throw new Error("setup aborted: git-crypt required");
    action = choice === "init" ? "init" : "none";
  }

  if (action === "init") {
    try {
      const { mkdirSync } = await import("node:fs");
      const { execFileSync } = await import("node:child_process");
      mkdirSync(io.syncDir, { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: io.syncDir, stdio: "ignore" });
      gitCryptInit(io.syncDir);
      writeGitattributes(io.syncDir, SENSITIVE_GLOBS);
      console.log("git-crypt initialized. Export and back up the key:");
      console.log(`  cd ${io.syncDir}`);
      console.log("  git-crypt export-key /secure/location/gh-sync.key");
      console.log("Share this key with all devices that need to decrypt.");
    } catch (err) {
      console.log(`git-crypt init failed: ${String(err)}. Proceeding without encryption.`);
      action = "none";
    }
  }

  const cfg: SyncConfig = {
    ...DEFAULT_CONFIG,
    repo,
    branch: plan.branch,
    instanceName: plan.instanceName,
    gitCryptEnabled: action === "init",
    syncStrategy,
  };
  const validation = io.configService.validate(cfg);
  if (!validation.ok) throw new Error(`setup aborted: invalid config: ${validation.errors.join("; ")}`);
  io.configService.save(cfg);
  io.writeCredentials(credentialsPath(ghSyncDir(io.stateDir)), repo, pat);
  return cfg;
}
