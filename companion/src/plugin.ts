/**
 * Georgios' Nemesis as a plugin of the Georgios' Map Maker companion. The companion loads this
 * file at start (it looks for ../georgios-nemesis/companion/src/plugin.ts beside its own folder,
 * or the paths in GMM_PLUGINS) and hands it every RPC method that starts with "nemesis.". So the
 * Foundry module, Claude, artgen and the world data all go through one companion.
 */

import { NemesisService } from "./service";

/** The shape the Map Maker companion expects from a plugin. */
export interface CompanionPlugin {
  name: string;
  prefix: string;
  call(method: string, params: Record<string, any>, ctx: { broadcast: (msg: unknown) => void }): Promise<unknown>;
}

export function createPlugin({ dataDir }: { dataDir: string; log?: (msg: string) => void }): CompanionPlugin {
  const service = new NemesisService(dataDir);
  return {
    name: "georgios-nemesis",
    prefix: "nemesis.",
    async call(method, params, ctx) {
      const result = await service.call(method, params);
      if (method === "nemesis.put") ctx.broadcast({ type: "nemesis.changed", world: params.world, kind: params.kind, id: params.record?.id });
      return result;
    },
  };
}
