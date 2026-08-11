import type { PathSegment, Point } from '@graphloom/core';
import type { RenderItem } from './scene.js';

/** Serializes an edge route (`PathRenderItem`) into SVG/Path2D path data. */
export const pathData = (item: RenderItem & { kind: 'path' }): string => {
  const [first, ...rest] = item.points;
  if (!first) return '';
  if (item.curve === 'cubic') {
    let d = `M ${first.x} ${first.y}`;
    for (let base = 1; base + 2 < item.points.length; base += 3) {
      const [c1, c2, to] = [rest[base - 1], rest[base], rest[base + 1]] as [Point, Point, Point];
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
    }
    return d;
  }
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
};

/** Serializes structured spec segments (P7-T01) into SVG/Path2D path data. */
export const segmentData = (segments: readonly PathSegment[]): string =>
  segments
    .map((s) => {
      switch (s.kind) {
        case 'M':
          return `M ${s.to.x} ${s.to.y}`;
        case 'L':
          return `L ${s.to.x} ${s.to.y}`;
        case 'C':
          return `C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.to.x} ${s.to.y}`;
        case 'Q':
          return `Q ${s.c.x} ${s.c.y}, ${s.to.x} ${s.to.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
