import { expect, it } from 'vitest';
import { commands } from './builtins.js';
import { createGraph } from './editor.js';
import { CommandValidationError } from './errors.js';
import type { GraphPlugin } from './plugin.js';
import type { ShapeDescriptor } from './shape.js';

const rectDescriptor: ShapeDescriptor = (node) => ({
  role: 'node',
  label: node.id,
  children: [{ kind: 'rect', x: 0, y: 0, width: node.size.width, height: node.size.height }],
});
const circleDescriptor: ShapeDescriptor = (node) => ({
  role: 'node',
  label: node.id,
  children: [
    {
      kind: 'ellipse',
      cx: node.size.width / 2,
      cy: node.size.height / 2,
      rx: node.size.width / 2,
      ry: node.size.height / 2,
    },
  ],
});

/** The P2-T08 acceptance plugin: registers a custom command and a validator. */
function makeTestPlugin(log: string[]): GraphPlugin {
  return {
    id: 'test-plugin',
    version: '1.2.3',
    install(ctx) {
      ctx.commands.register<{ id: string; tag: string }>('test.tag', {
        validate(model, { id }) {
          if (!model.getNode(id)) throw new CommandValidationError('test.tag', `no node ${id}`);
        },
        invert(model, { id }) {
          const previous = model.getNode(id)!.data['tag'] ?? null;
          return { type: 'node.update', payload: { id, changes: { data: { tag: previous } } } };
        },
        apply(model, { id, tag }, ctx2) {
          const previous = model.getNode(id)!;
          const next = { ...previous, data: { ...previous.data, tag } };
          model.replaceNode(next);
          ctx2.emit('node.updated', { node: next, previous });
        },
      });
      ctx.validators.register('no-self-loops', (_model, edge) =>
        edge.source === edge.target ? 'self-loops are not allowed' : true,
      );
      ctx.on('node.created', ({ node }) => log.push(node.id));
      ctx.contributions.register('tag-button', {
        kind: 'toolbar',
        item: { label: 'Tag', command: 'test.tag' },
      });
      ctx.aiActions.register('summarize', {
        title: 'Summarize diagram',
        description: 'Produce a text summary of the current graph.',
      });
      ctx.shapes.register('sticky-note', (node) => ({
        role: 'node',
        label: node.id,
        children: [
          { kind: 'rect', x: 0, y: 0, width: node.size.width, height: node.size.height },
        ],
      }));
    },
    uninstall() {
      log.push('uninstalled');
    },
  };
}

it('a plugin registers a custom command + validator and is cleanly uninstalled (P2-T08 acceptance)', () => {
  const editor = createGraph();
  const log: string[] = [];
  const loaded: unknown[] = [];
  editor.on('plugin.loaded', (e) => loaded.push(e));
  editor.use(makeTestPlugin(log));
  expect(loaded).toEqual([{ pluginId: 'test-plugin', version: '1.2.3' }]);
  expect(editor.plugins()).toEqual(['test-plugin']);

  // custom command works through the ordinary bus path
  editor.execute(commands.nodeAdd({ id: 'a' }));
  expect(log).toEqual(['a']); // plugin event subscription is live
  editor.execute({ type: 'test.tag', payload: { id: 'a', tag: 'hot' } });
  expect(editor.graph.getNode('a')!.data['tag']).toBe('hot');

  // registered validator rejects self-loops with a typed error and no state change
  expect(() => editor.execute(commands.edgeAdd({ source: 'a', target: 'a' }))).toThrow(
    CommandValidationError,
  );
  expect(editor.graph.edgeCount).toBe(0);
  expect(editor.registries.contributions.get('tag-button')).toBeDefined();
  expect(editor.registries.aiActions.get('summarize')).toBeDefined();
  expect(editor.registries.shapes.get('sticky-note')).toBeDefined();

  // uninstall reverts every registration
  editor.unuse('test-plugin');
  expect(log).toContain('uninstalled');
  expect(editor.plugins()).toEqual([]);
  expect(() => editor.execute({ type: 'test.tag', payload: { id: 'a', tag: 'x' } })).toThrow(
    /unknown command type/,
  );
  editor.execute(commands.edgeAdd({ id: 'loop', source: 'a', target: 'a' })); // validator gone
  expect(editor.graph.edgeCount).toBe(1);
  expect(editor.registries.contributions.get('tag-button')).toBeUndefined();
  expect(editor.registries.aiActions.get('summarize')).toBeUndefined();
  expect(editor.registries.shapes.get('sticky-note')).toBeUndefined();
  const before = log.length;
  editor.execute(commands.nodeAdd({ id: 'b' }));
  expect(log).toHaveLength(before); // event subscription was auto-removed
});

it('rejects double-install', () => {
  const editor = createGraph();
  const plugin = makeTestPlugin([]);
  editor.use(plugin);
  expect(() => editor.use(plugin)).toThrow(/already installed/);
});

it('uninstall is idempotent (unknown ids are a no-op)', () => {
  const editor = createGraph();
  expect(() => editor.unuse('never-installed')).not.toThrow();
});

it('installs plugins in deterministic dependency order', () => {
  const order: string[] = [];
  const make = (id: string, dependencies: string[] = []): GraphPlugin => ({
    id,
    version: '0.0.0',
    dependencies,
    install: () => {
      order.push(id);
    },
  });
  const editor = createGraph();
  editor.use(make('c', ['b']), make('b', ['a']), make('a'));
  expect(order).toEqual(['a', 'b', 'c']);
  expect(editor.plugins()).toEqual(['a', 'b', 'c']);
});

it('accepts dependencies that are already installed', () => {
  const editor = createGraph();
  const base: GraphPlugin = { id: 'base', version: '0', install: () => {} };
  const addon: GraphPlugin = {
    id: 'addon',
    version: '0',
    dependencies: ['base'],
    install: () => {},
  };
  editor.use(base);
  editor.use(addon);
  expect(editor.plugins()).toEqual(['base', 'addon']);
});

it('rejects missing and cyclic dependencies', () => {
  const editor = createGraph();
  expect(() =>
    editor.use({ id: 'x', version: '0', dependencies: ['ghost'], install: () => {} }),
  ).toThrow(/missing plugin ghost/);
  expect(() =>
    editor.use(
      { id: 'a', version: '0', dependencies: ['b'], install: () => {} },
      { id: 'b', version: '0', dependencies: ['a'], install: () => {} },
    ),
  ).toThrow(/dependency cycle/);
});

it('refuses to uninstall a plugin something still depends on', () => {
  const editor = createGraph();
  editor.use(
    { id: 'base', version: '0', install: () => {} },
    { id: 'addon', version: '0', dependencies: ['base'], install: () => {} },
  );
  expect(() => editor.unuse('base')).toThrow(/addon depends on it/);
  editor.unuse('addon');
  editor.unuse('base'); // fine once the dependent is gone
  expect(editor.plugins()).toEqual([]);
});

it('registry keys are exclusive and unregister works mid-lifetime', () => {
  const editor = createGraph();
  editor.use({
    id: 'p1',
    version: '0',
    install(ctx) {
      ctx.shapes.register('shape', rectDescriptor);
      expect(() => ctx.shapes.register('shape', circleDescriptor)).toThrow(
        /already registered/,
      );
      expect(ctx.shapes.keys()).toEqual(['shape']);
      ctx.shapes.unregister('shape');
      ctx.shapes.register('shape', circleDescriptor);
    },
  });
  expect(editor.registries.shapes.get('shape')).toBe(circleDescriptor);
});
