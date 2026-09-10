import type { GraphPlugin } from '@graphloom/core';
import type { RenderHost } from '@graphloom/rendering';
import { createMinimap, type MinimapHandle, type MinimapOptions } from './minimap.js';

// Keep in sync with package.json "version" (changesets bumps both on release).
const MINIMAP_VERSION = '0.0.1';

/** Inputs for the {@link minimap} plugin. */
export interface MinimapPluginConfig {
  /** The primary rendering pipeline the minimap mirrors. */
  readonly host: RenderHost;
  /** Element the minimap mounts into. */
  readonly mount: HTMLElement;
  /** Optional minimap tunables. */
  readonly options?: MinimapOptions;
}

/**
 * The minimap as an installable {@link GraphPlugin}: `editor.use(minimap({
 * host, mount }))` mounts it and `editor.unuse('minimap')` tears it down. The
 * rendering handles ride this config (the core `PluginContext` has no
 * rendering access by design); model-change tracking is wired to
 * `ctx.on('graph.change')`.
 */
export function minimap(config: MinimapPluginConfig): GraphPlugin {
  let handle: MinimapHandle | null = null;
  return {
    id: 'minimap',
    version: MINIMAP_VERSION,
    install(ctx) {
      handle = createMinimap({
        host: config.host,
        mount: config.mount,
        watch: (cb) => ctx.on('graph.change', cb),
        ...(config.options !== undefined ? { options: config.options } : {}),
      });
    },
    uninstall() {
      handle?.destroy();
      handle = null;
    },
  };
}
