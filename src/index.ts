import { homedir } from "node:os";
import { join } from "node:path";
import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { createRuntime, registerCommands, type CommanderProgram } from "./cli.js";

export interface MinimalApi {
  id: string;
  pluginConfig: Record<string, unknown>;
  registerCli(registrar: (ctx: { program: unknown }) => void, opts?: unknown): unknown;
  on(hookName: string, handler: () => void | Promise<void>): unknown;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export function createPlugin(api: MinimalApi): void {
  const rt = createRuntime({ stateDir: process.env.OPENCLAW_STATE_DIR ?? joinHomeOpenclaw(), env: process.env });

  api.on("gateway_start", () => void rt.start());
  api.on("gateway_stop", () => void rt.stop());

  api.registerCli(
    async ({ program }) => {
      registerCommands(program as unknown as CommanderProgram, rt);
    },
    {
      parentPath: ["gh-sync"],
      descriptors: [{ name: "gh-sync", description: "OpenClaw GitHub sync and backup", hasSubcommands: true }],
    },
  );
}

function joinHomeOpenclaw(): string {
  return join(homedir(), ".openclaw");
}

const pluginEntry: OpenClawPluginDefinition = definePluginEntry({
  id: "openclaw-gh-sync",
  name: "OpenClaw GitHub Sync",
  description: "Real-time GitHub sync plus scheduled official-backup archive upload",
  register(api) {
    createPlugin(api as unknown as MinimalApi);
  },
});

export default pluginEntry;
