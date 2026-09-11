import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { darkTheme } from '@graphloom/themes';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg-export.js';

const editorWith = (build: (ed: GraphEditor) => void): GraphEditor => {
  const ed = createGraph();
  ed.transact(() => build(ed));
  return ed;
};

describe('exportSvg', () => {
  it('produces a standalone, namespaced SVG document', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 100, height: 40 } }));
    });
    const svg = exportSvg(ed);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox=');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('defaults to the full graph bounds plus padding', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 10, y: 20 }, size: { width: 100, height: 40 } }));
    });
    const svg = exportSvg(ed, { padding: 5 });
    // node bounds x:10..110, y:20..60 -> padded viewBox starts at 10-5, 20-5
    expect(svg).toMatch(/viewBox="5 15 110 50"/);
  });

  it('crops to an explicit bounds rect, excluding nodes outside it', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'near', position: { x: 0, y: 0 }, size: { width: 20, height: 20 } }));
      e.execute(commands.nodeAdd({ id: 'far', position: { x: 1000, y: 1000 }, size: { width: 20, height: 20 } }));
    });
    const svg = exportSvg(ed, { bounds: { x: -10, y: -10, width: 60, height: 60 } });
    expect(svg).toContain('data-item="node:near"');
    expect(svg).not.toContain('far');
  });

  it('fills the background from the theme by default, and can be made transparent', () => {
    const ed = editorWith(() => {});
    const withBg = exportSvg(ed, { bounds: { x: 0, y: 0, width: 10, height: 10 } });
    expect(withBg).toContain('fill="#ffffff"'); // lightTheme default background

    const dark = exportSvg(ed, { theme: darkTheme, bounds: { x: 0, y: 0, width: 10, height: 10 } });
    expect(dark).toContain(darkTheme.tokens.background);

    const transparent = exportSvg(ed, {
      background: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(transparent).not.toContain('<rect x="0" y="0" width="10" height="10" fill=');
  });

  it('falls back to a non-degenerate viewBox for an empty graph', () => {
    const svg = exportSvg(editorWith(() => {}));
    expect(svg).not.toMatch(/viewBox="[\d.-]+ [\d.-]+ 0 0"/);
  });

  it('renders a rect node with theme-resolved fill and stroke', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 100, height: 40 } }));
    });
    const svg = exportSvg(ed);
    expect(svg).toMatch(/<rect[^>]*data-item="node:a"[^>]*fill="#[0-9a-f]{6}"/);
    expect(svg).toMatch(/stroke="#[0-9a-f]{6}"/);
  });

  it('renders an ellipse-typed node as an <ellipse>', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', type: 'ellipse', position: { x: 0, y: 0 }, size: { width: 100, height: 40 } }));
    });
    const svg = exportSvg(ed);
    expect(svg).toContain('<ellipse');
  });

  it('applies a rotate() transform about the node center', () => {
    const ed = editorWith((e) => {
      e.execute(
        commands.nodeAdd({
          id: 'a',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 40 },
          rotation: 30,
        }),
      );
    });
    const svg = exportSvg(ed);
    expect(svg).toMatch(/transform="rotate\(30 50 20\)"/);
  });

  it('renders and XML-escapes a node label using theme font tokens', () => {
    const ed = editorWith((e) => {
      e.execute(
        commands.nodeAdd({
          id: 'a',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 40 },
          data: { label: 'A & <B>' },
        }),
      );
    });
    const svg = exportSvg(ed);
    expect(svg).toContain('A &amp; &lt;B&gt;');
    expect(svg).toContain('font-family="system-ui, sans-serif"');
  });

  it('renders an edge as a stroked, unfilled path with no arrowhead marker', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 40, height: 40 } }));
      e.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 0 }, size: { width: 40, height: 40 } }));
      e.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    });
    const svg = exportSvg(ed);
    expect(svg).toMatch(/<path[^>]*data-item="edge:e"[^>]*fill="none"/);
    expect(svg).not.toContain('marker-end');
    expect(svg).not.toContain('<marker');
  });

  it('renders a P7-T06 edge-end marker as its own scaled, rotated path', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 40, height: 40 } }));
      e.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 0 }, size: { width: 40, height: 40 } }));
      e.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b', data: { markerEnd: 'arrow' } }));
    });
    const svg = exportSvg(ed);
    expect(svg).toMatch(/<path[^>]*data-item="marker:edge:e:end"[^>]*transform="translate\(/);
  });

  it('renders a polygon-shaped node (e.g. a diamond) as <polygon>', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', type: 'diamond', position: { x: 0, y: 0 }, size: { width: 40, height: 40 } }));
    });
    expect(exportSvg(ed)).toContain('<polygon');
  });

  it('renders a path-shaped node (e.g. a cloud) as its own <path>', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', type: 'cloud', position: { x: 0, y: 0 }, size: { width: 60, height: 40 } }));
    });
    expect(exportSvg(ed)).toMatch(/<path[^>]*data-item="node:a"/);
  });

  it('renders a roundRect-shaped node (e.g. a container) with an rx', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', type: 'container', position: { x: 0, y: 0 }, size: { width: 80, height: 60 } }));
    });
    expect(exportSvg(ed)).toMatch(/<rect[^>]*data-item="node:a"[^>]*rx="3"/);
  });

  it('renders an image node with its href, and an icon node with its icon name', () => {
    const ed = editorWith((e) => {
      e.execute(
        commands.nodeAdd({
          id: 'pic',
          type: 'image',
          position: { x: 0, y: 0 },
          size: { width: 40, height: 40 },
          data: { src: 'https://example.com/x.png' },
        }),
      );
      e.execute(
        commands.nodeAdd({
          id: 'ico',
          type: 'icon',
          position: { x: 100, y: 0 },
          size: { width: 40, height: 40 },
          data: { icon: 'star' },
        }),
      );
    });
    const svg = exportSvg(ed);
    expect(svg).toContain('<image');
    expect(svg).toContain('href="https://example.com/x.png"');
    expect(svg).toContain('data-icon="star"');
  });

  it('excludes the SVG-only grid extra (parity with the Canvas view)', () => {
    const ed = editorWith(() => {});
    const svg = exportSvg(ed);
    expect(svg).not.toContain('pattern');
  });

  it('excludes hover-only ports (no hover state is ever set) but keeps always-visible ones', () => {
    const ed = editorWith((e) => {
      e.execute(
        commands.nodeAdd({
          id: 'a',
          position: { x: 0, y: 0 },
          size: { width: 40, height: 40 },
          ports: [
            { id: 'hoverOnly', side: 'right' },
            { id: 'alwaysOn', side: 'left', visibility: 'always' },
          ],
        }),
      );
    });
    const svg = exportSvg(ed);
    expect(svg).not.toContain('hoverOnly');
    expect(svg).toContain('alwaysOn');
  });

  it('reflects the current editor state on every call (no stale scene reused)', () => {
    const ed = editorWith((e) => {
      e.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 40, height: 40 } }));
    });
    const before = exportSvg(ed);
    expect(before).toContain('data-item="node:a"');
    ed.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 0 }, size: { width: 40, height: 40 } }));
    const after = exportSvg(ed);
    expect(after).toContain('data-item="node:b"');
  });
});
