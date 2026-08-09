import { join } from "node:path";
import { sanitizeInstanceName, type ConfigService } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
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
  const repo = String(await prompts.text({ message: "GitHub repository URL (https://github.com/owner/repo)" }));
  const pat = String(await prompts.text({ message: "GitHub Personal Access Token (fine-grained, contents:write)" }));
  const instanceNameRaw = String(await prompts.text({ message: "Instance name" }));

  const plan = planForSetup({
    instanceNameRaw,
    repo,
    gitCryptAvailable: io.gitCryptAvailable(),
    gitCryptEnabled: true,
  });

  let action: SetupPlan["gitCryptAction"] = plan.gitCryptAction;
  if (action === "skip-sensitive") {
    console.log(GIT_CRYPT_INSTALL_HINT);
    const choice = (await prompts.select({
      message: "git-crypt is missing. How do you want to proceed?",
      options: [
        { value: "init", label: "Install hint — I'll install git-crypt (brew/apt), proceed" },
        { value: "degraded", label: "Degraded mode — sensitive paths stay plaintext" },
        { value: "abort", label: "Abort setup" },
      ],
    })) as "init" | "degraded" | "abort";
    if (choice === "abort") throw new Error("setup aborted: git-crypt required");
    action = choice === "init" ? "init" : "none";
  }

  const cfg: SyncConfig = {
    ...DEFAULT_CONFIG,
    repo,
    branch: plan.branch,
    instanceName: plan.instanceName,
    gitCryptEnabled: action === "init",
  };
  io.configService.save(cfg);
  io.writeCredentials(join(io.stateDir, "gh-sync", ".git-credentials"), repo, pat);
  return cfg;
}
