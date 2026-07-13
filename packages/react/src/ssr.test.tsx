// @vitest-environment node
//
// P6-T04: runs WITHOUT any DOM. Importing the package here is itself the
// proof that nothing in the dependency chain touches window/document at
// module scope (ADR-0002 SSR rule); rendering proves the server markup.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Graph, useGraph, useSelection, useUndoRedo, useViewport } from './index.js';

const Toolbar = (): ReturnType<typeof String> => {
  const { ready, nodes } = useGraph();
  const selection = useSelection();
  const viewport = useViewport();
  const { canUndo } = useUndoRedo();
  return `ready=${ready} nodes=${nodes.length} selected=${selection.length} zoom=${viewport.zoom} canUndo=${canUndo}`;
};

describe('RSC/SSR compliance (P6-T04)', () => {
  it('server-renders the stable container — no editor, no svg', () => {
    const html = renderToString(<Graph className="host" />);
    expect(html).toContain('data-graphloom-canvas'); // stable host for hydration
    expect(html).not.toContain('<svg'); // the renderer never ran on the server
    expect(html).not.toContain('data-graphloom-overlay'); // overlays are client-only
  });

  it('hooks are server-safe and serve the empty defaults', () => {
    const html = renderToString(
      <Graph>
        <Toolbar />
      </Graph>,
    );
    expect(html).toContain('ready=false nodes=0 selected=0 zoom=1 canUndo=false');
  });

  // The 'use client' boundary on the shipped bundle is asserted by
  // tools/check-packages.mjs (pkgcheck) — a build-artifact concern.
});
