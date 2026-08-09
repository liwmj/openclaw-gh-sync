import { existsSync } from "node:fs";
import { join } from "node:path";
import { simpleGit, type StatusResult } from "simple-git";
import type { AheadBehind } from "./types.js";

export class GitOps {
  private readonly git;

  constructor(
    private readonly syncDir: string,
    private readonly repoUrl: string,
    private readonly branch: string,
    private readonly credentialsFile: string | null,
  ) {
    this.git = simpleGit(syncDir);
  }

  async initRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
    }
    if (this.credentialsFile) {
      await this.git.addConfig("credential.helper", `store --file ${this.credentialsFile}`);
      await this.git.addConfig("http.version", "HTTP/1.1");
      await this.git.addConfig("http.lowSpeedLimit", "0");
      await this.git.addConfig("http.lowSpeedTime", "999999");
    }
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin) {
      await this.git.addRemote("origin", this.repoUrl);
    } else if (origin.refs.fetch !== this.repoUrl) {
      await this.git.removeRemote("origin");
      await this.git.addRemote("origin", this.repoUrl);
    }
    await this.ensureBranch(this.branch);
  }

  async ensureBranch(name: string): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.current === name) return;
    if (branches.all.includes(name)) {
      await this.git.checkout(name);
      return;
    }
    const existing = await this.remoteRefExists(name);
    if (existing) {
      await this.git.checkout(["-B", name, `origin/${name}`]);
    } else {
      await this.git.checkoutLocalBranch(name);
    }
  }

  async remoteRefExists(branch: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `origin/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<boolean> {
    try {
      await this.git.fetch("origin", this.branch);
      return await this.remoteRefExists(this.branch);
    } catch {
      return false;
    }
  }

  async commitChanged(message: string): Promise<boolean> {
    await this.git.add(".");
    const status = await this.git.status();
    if (status.isClean()) return false;
    await this.git.commit(message);
    return true;
  }

  async push(): Promise<void> {
    await this.git.push("origin", this.branch);
  }

  async cleanWorkingTree(): Promise<boolean> {
    return (await this.git.status()).isClean();
  }

  async statusRaw(): Promise<StatusResult> {
    return this.git.status();
  }

  async aheadBehind(): Promise<AheadBehind> {
    const output = await this.git.raw(["rev-list", "--left-right", "--count", `HEAD...origin/${this.branch}`]);
    const [ahead = "0", behind = "0"] = output.trim().split(/\s+/);
    return { ahead: Number.parseInt(ahead, 10) || 0, behind: Number.parseInt(behind, 10) || 0 };
  }
}
