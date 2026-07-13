import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graph } from './graph.js';
import { useGraph } from './hooks.js';

const Status = (): ReturnType<typeof String> => {
  const { ready } = useGraph();
  return `ready=${ready}`;
};

const App = (): ReturnType<typeof Graph> => (
  <Graph>
    <Status />
  </Graph>
);

describe('hydration (P6-T04)', () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
  });

  it('hydrates the server markup warning-free, then mounts the editor', () => {
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(<App />);
    expect(container.querySelector('svg')).toBeNull();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <App />, {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    expect(recoverable).toEqual([]); // no hydration mismatch
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();

    // The client effect took over: the editor is live inside the same host.
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('ready=true');
    container.remove();
  });
});
