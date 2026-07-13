// This file is a React Server Component (deliberately NOT 'use client'):
// importing <Graph> here is the P6-T04 acceptance — the package's client
// boundary must flip this subtree to the client cleanly, and `next build`
// prerenders it (server-renders the placeholder markup) on the way.
import { Graph } from '@graphloom/react';

/** A Server Component page embedding the client-boundary editor. */
export default function Page(): React.ReactNode {
  return (
    <main>
      <h1>GraphLoom inside an RSC tree</h1>
      <Graph style={{ height: 480 }} />
    </main>
  );
}
