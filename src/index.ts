export interface MinimalApi {
  id: string;
  pluginConfig: Record<string, unknown>;
  registerCli(registrar: (ctx: { program: unknown }) => void, opts?: unknown): unknown;
  on(hookName: string, handler: () => void | Promise<void>): unknown;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export function createPlugin(_api: MinimalApi): void {
  void _api;
}
