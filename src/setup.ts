import { isCancel } from "@clack/prompts";
import { sanitizeInstanceName, type ConfigService } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { credentialsPath, ghSyncDir } from "./paths.js";
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
    configService: ConfigService;
    gitCryptAvailable: () => boolean;
    writeCredentials: (file: string, repo: string, pat: string) => void;
  };
}): Promise<SyncConfig> {
  const { prompts, io } = opts;

  const abort = (what: string): never => {
    throw new Error(`setup aborted: ${what} cancelled`);
  };

  const repoRes = await prompts.text({ message: "GitHub repository URL (https://github.com/owner/repo)" });
  if (isCancel(repoRes)) abort("repo");
  const patRes = await prompts.text({ message: "GitHub Personal Access Token (fine-grained, contents:write)" });
  if (isCancel(patRes)) abort("PAT");
  const instanceNameRawRes = await prompts.text({ message: "Instance name" });
  if (isCancel(instanceNameRawRes)) abort("instance name");
  const repo = String(repoRes);
  const pat = String(patRes);
  const instanceNameRaw = String(instanceNameRawRes);

  const strategyRes = await prompts.select({
    message: "How should sync handle existing remote data?",
    options: [
      { value: "merge", label: "Merge — combine local and remote data (recommended)" },
      { value: "replace-local", label: "Replace local — overwrite local with remote (use when migrating)" },
    ],
  });
  if (isCancel(strategyRes)) abort("strategy selection");
  const syncStrategy = strategyRes as SyncConfig["syncStrategy"];

  const plan = planForSetup({
    instanceNameRaw,
    repo,
    gitCryptAvailable: io.gitCryptAvailable(),
    gitCryptEnabled: true,
  });

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
