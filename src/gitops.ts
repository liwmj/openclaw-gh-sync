import { copyFileSync, existsSync, mkdirSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { simpleGit, type StatusResult } from "simple-git";
import type { AheadBehind, PullOutcome } from "./types.js";

export class GitOps {
  private readonly git;

  constructor(
    private readonly syncDir: string,
    private readonly repoUrl: string,
    private readonly branch: string,
    private readonly pat: string | null,
  ) {
    this.git = simpleGit({ baseDir: syncDir, timeout: { block: 30_000 }, unsafe: { allowUnsafeEditor: true } }).env({
      // 必须展开 process.env 保留 HOME/PATH 等：只覆盖 LANG/LC_ALL，
      // 否则子进程环境被替换后 git 读不到 ~/.gitconfig 的 user.name/email → commit 报 Author identity unknown
      ...process.env,
      LANG: "C",
      LC_ALL: "C",
      LC_MESSAGES: "C",
      // Bug B 修复：http(s) 传输阶段无数据超 30s 时 git 自身中止，防止超时后子进程残留累积
      GIT_HTTP_LOW_SPEED_LIMIT: "1",
      GIT_HTTP_LOW_SPEED_TIME: "30",
    });
  }

  async initRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
    }
    this.writeGitignore();
    const authedUrl = this.pat ? this.repoUrl.replace("https://", `https://x-access-token:${encodeURIComponent(this.pat)}@`) : this.repoUrl;
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin) {
      await this.git.addRemote("origin", authedUrl);
    } else if (origin.refs.fetch !== authedUrl) {
      await this.git.removeRemote("origin");
      await this.git.addRemote("origin", authedUrl);
    }
    await this.fetch();
    await this.ensureBranch(this.branch);
    await this.cleanStaleInstanceBranches();
  }

  private async cleanStaleInstanceBranches(): Promise<void> {
    const branches = await this.git.branchLocal();
    for (const b of branches.all) {
      if (b.startsWith("instances/") && b !== this.branch && b !== branches.current) {
        await this.git.deleteLocalBranch(b, true).catch(() => {});
      }
    }
  }

  async ensureBranch(name: string): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.current === name) return;
    if (branches.all.includes(name)) {
      if (await this.remoteRefExists(name)) {
        await this.git.checkout(["-f", "-B", name, `origin/${name}`]);
      } else {
        await this.git.checkout(["-f", name]);
      }
      return;
    }
    const existing = await this.remoteRefExists(name);
    if (existing) {
      await this.git.checkout(["-f", "-B", name, `origin/${name}`]);
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

  async fetchBranch(branch: string): Promise<boolean> {
    try {
      await this.git.fetch("origin", branch);
    } catch {
      if (!(await this.remoteRefExists(branch))) return false;
      throw new Error(`failed to fetch branch ${branch}: network or auth error`);
    }
    return await this.remoteRefExists(branch);
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

  async pushCurrent(): Promise<void> {
    await this.git.push("origin", "HEAD");
  }

  async cleanWorkingTree(): Promise<boolean> {
    return (await this.git.status()).isClean();
  }

  private writeGitignore(): void {
    const ignorePath = join(this.syncDir, ".gitignore");
    fsWriteFileSync(ignorePath, [
      ".git-credentials",
      "backups/*",
      "!backups/*.tar.gz",
      "*.sqlite",
      "*.sqlite-*",
      "*.jsonl",
      "*.jsonl.*",
      ".local.*",
      ".theirs.*",
      "",
    ].join("\n"));
  }

  async statusRaw(): Promise<StatusResult> {
    return this.git.status();
  }

  async aheadBehind(): Promise<AheadBehind> {
    const output = await this.git.raw(["rev-list", "--left-right", "--count", `HEAD...origin/${this.branch}`]);
    const [ahead = "0", behind = "0"] = output.trim().split(/\s+/);
    return { ahead: Number.parseInt(ahead, 10) || 0, behind: Number.parseInt(behind, 10) || 0 };
  }

  async mergeRemote(policy: "ours" | "theirs"): Promise<"merged" | "conflict"> {
    const flag = policy === "ours" ? "-Xours" : "-Xtheirs";
    try {
      await this.git.merge([flag, `origin/${this.branch}`]);
      return "merged";
    } catch {
      return "conflict";
    }
  }

  async pull(): Promise<PullOutcome> {
    await this.fetch();
    if (!(await this.remoteRefExists(this.branch))) return { status: "up-to-date" };
    const { ahead, behind } = await this.aheadBehind();
    if (behind === 0) return { status: "up-to-date" };
    const changedFiles = await this.listChangedFiles("HEAD", `origin/${this.branch}`);
    if (ahead === 0) {
      try {
        await this.git.merge(["--ff-only", `origin/${this.branch}`]);
        return { status: "ok", changedFiles };
      } catch {
        const conflictCopies = await this.saveLocalConflictFiles(changedFiles, Date.now().toString(), "local");
        await this.forceAcceptRemote(this.branch);
        return { status: "ok", changedFiles, conflictCopies };
      }
    }
    const conflictCopies = await this.saveLocalConflictFiles(changedFiles, Date.now().toString(), "local");
    const result = await this.mergeRemote("theirs");
    if (result === "conflict") {
      await this.acceptRemoteForConflicts();
      const status = await this.git.status();
      if (!status.isClean()) {
        await this.git.commit("Resolve conflicts: accept remote");
      }
    }
    return { status: "ok", changedFiles, conflictCopies };
  }

  async forceAcceptRemote(branch: string): Promise<void> {
    await this.git.merge(["--abort"]).catch(() => {});
    await this.git.reset(["--hard", `origin/${branch}`]);
  }

  async acceptRemoteForConflicts(): Promise<void> {
    const status = await this.git.status();
    for (const file of status.conflicted) {
      await this.git.raw(["checkout", "--theirs", file]);
      await this.git.add(file);
    }
  }

  async listChangedFiles(fromRef: string, toRef: string): Promise<string[]> {
    const output = await this.git.raw(["diff", "--name-only", `${fromRef}..${toRef}`]);
    return output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  async saveRemoteConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]> {
    const written: string[] = [];
    for (const filePath of filePaths) {
      try {
        const content = await this.git.raw(["show", `origin/${this.branch}:${filePath.replace(/\\/g, "/")}`]);
        const target = join(this.syncDir, `${filePath}.${label}.${timestamp}`);
        mkdirSync(dirname(target), { recursive: true });
        fsWriteFileSync(target, content);
        written.push(`${filePath}.${label}.${timestamp}`);
      } catch {
        continue;
      }
    }
    return written;
  }

  async saveLocalConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]> {
    const written: string[] = [];
    for (const filePath of filePaths) {
      const source = join(this.syncDir, filePath);
      if (!existsSync(source)) continue;
      const target = join(this.syncDir, `${filePath}.${label}.${timestamp}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      written.push(`${filePath}.${label}.${timestamp}`);
    }
    return written;
  }
}
