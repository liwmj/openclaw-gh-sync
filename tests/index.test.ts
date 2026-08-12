import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlugin, type MinimalApi } from "../src/index.js";

// commander-like mock: program.command("gh-sync") -> ghSync; ghSync.command("status") records subcommand
function makeProgram() {
  const root: { name: string; subs: string[] }[] = [];
  const find = (name: string) => root.find((n) => n.name === name);
  const ensure = (name: string) => {
    let n = find(name);
    if (!n) { n = { name, subs: [] }; root.push(n); }
    return n;
  };
  const chain = (name: string) => ({
    description: () => chain(name),
    option: () => chain(name),
    command: (sub: string) => {
      ensure(name).subs.push(sub);
      return chain(sub);
    },
    action: () => chain(name),
  });
  return {
    root,
    command: (name: string) => chain(name),
    description: () => chain("root"),
  } as unknown as { command(name: string): unknown; description(): unknown };
}

function makeApi() {
  const handlers = new Map<string, () => void | Promise<void>>();
  const program = makeProgram();
  const registerCli = vi.fn(async (registrar: (ctx: { program: unknown }) => void | Promise<void>) => {
    await registrar({ program });
  });
  const api: MinimalApi = {
    id: "openclaw-gh-sync",
    pluginConfig: {},
    registerCli,
    on: vi.fn((hook: string, handler: () => void | Promise<void>) => {
      handlers.set(hook, handler);
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { api, handlers, program };
}

describe("plugin entry", () => {
  it("registers gateway_start / gateway_stop hooks and gh-sync CLI on createPlugin", async () => {
    const { api, handlers, program } = makeApi();
    process.env.OPENCLAW_STATE_DIR = mkdtempSync(join(tmpdir(), "idx-"));
    createPlugin(api);
    delete process.env.OPENCLAW_STATE_DIR;

    expect(handlers.has("gateway_start")).toBe(true);
    expect(handlers.has("gateway_stop")).toBe(true);
    expect(api.registerCli).toHaveBeenCalled();
    await expect(api.registerCli.mock.results[0].value).resolves.toBeUndefined();

    const ghSyncNode = program.root.find((n) => n.name === "gh-sync");
    expect(ghSyncNode).toBeTruthy();
    expect(ghSyncNode!.subs).toEqual(expect.arrayContaining(["status", "push", "pull", "sync", "backup", "conflicts", "setup", "reset"]));
  });

  it("createPlugin does not throw with minimal api", () => {
    const { api } = makeApi();
    process.env.OPENCLAW_STATE_DIR = mkdtempSync(join(tmpdir(), "idx-"));
    expect(() => createPlugin(api)).not.toThrow();
    delete process.env.OPENCLAW_STATE_DIR;
  });
});
