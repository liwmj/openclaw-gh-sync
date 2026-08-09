# SDK call signatures used by this plugin

- Entry: `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";`
  `definePluginEntry({ id, name, description, register(api) { ... } })`
- CLI: `api.registerCli(async ({ program }) => { ... }, { descriptors: [{ name: "gh-sync", description: "...", hasSubcommands: true }] })`
  - `commands` and `parentPath` also supported.
- Lifecycle: `api.on("gateway_start", handler)` and `api.on("gateway_stop", handler)`.
- Config: `api.pluginConfig` (Record<string, unknown>) = `plugins.entries.<id>.config`.
- Logger: `api.logger.info|warn|error`.
- Runtime helpers: `api.runtime` (spawn, subagent, etc.).
