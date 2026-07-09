import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  commands,
  createGraph,
  type GraphSnapshot,
} from '@graphloom/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphComponent } from './graph.component.js';

/** Builds a document snapshot the lazy way: through a scratch editor. */
const makeDocument = (): GraphSnapshot => {
  const scratch = createGraph({ meta: { name: 'doc' } });
  scratch.transact(() => {
    scratch.execute(
      commands.nodeAdd({
        id: 'a',
        position: { x: 100, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'out', side: 'right' }],
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'b',
        position: { x: 400, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'in', side: 'left' }],
      }),
    );
    scratch.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  });
  return scratch.snapshot();
};

const create = (
  inputs: Partial<Record<'document' | 'limits', unknown>> = {},
): ComponentFixture<GraphComponent> => {
  const fixture = TestBed.createComponent(GraphComponent);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges(); // flushes afterNextRender → editor created
  TestBed.tick(); // flushes the document-loading effect
  return fixture;
};

describe('GraphComponent (P5-T01)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('exposes inert defaults before the first render (server-safe reads)', () => {
    const fixture = TestBed.createComponent(GraphComponent);
    const component = fixture.componentInstance;
    expect(component.ready()).toBe(false);
    expect(component.nodes()).toEqual([]);
    expect(component.edges()).toEqual([]);
    expect(component.groups()).toEqual([]);
    expect(component.selection()).toEqual([]);
    expect(component.viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(component.canUndo()).toBe(false);
    expect(component.canRedo()).toBe(false);
    expect(component.editor()).toBeNull();
    expect(component.history()).toBeNull();
    expect(component.clipboard()).toBeNull();
    expect(component.engine()).toBeNull();
    expect(component.host()).toBeNull();
    expect(component.overlays()).toEqual([]);
    fixture.destroy(); // teardown before init is a no-op
  });

  it('loads (and clears) groups from document snapshots', () => {
    const scratch = createGraph();
    scratch.transact(() => {
      scratch.execute(
        commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
      );
      scratch.execute(
        commands.nodeAdd({ id: 'b', position: { x: 30, y: 0 }, size: { width: 10, height: 10 } }),
      );
      scratch.execute(commands.groupCreate({ id: 'g', members: ['a', 'b'] }));
    });
    const fixture = create({ document: scratch.snapshot() });
    expect(fixture.componentInstance.groups().map((g) => g.id)).toEqual(['g']);

    fixture.componentRef.setInput('document', createGraph().snapshot());
    TestBed.tick();
    expect(fixture.componentInstance.groups()).toEqual([]);
    expect(fixture.componentInstance.nodes()).toEqual([]);
  });

  it('loads the document input in one transaction and clears history', () => {
    const fixture = create({ document: makeDocument() });
    const component = fixture.componentInstance;
    expect(component.nodes().map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(component.edges().map((e) => e.id)).toEqual(['ab']);
    expect(component.canUndo()).toBe(false); // loading is not user work
  });

  it('reloads when the document input changes', () => {
    const fixture = create({ document: makeDocument() });
    const replacement = createGraph();
    replacement.execute(
      commands.nodeAdd({ id: 'solo', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
    );
    fixture.componentRef.setInput('document', replacement.snapshot());
    TestBed.tick();
    expect(fixture.componentInstance.nodes().map((n) => n.id)).toEqual(['solo']);
    expect(fixture.componentInstance.edges()).toEqual([]);
    expect(fixture.componentInstance.canUndo()).toBe(false);
  });

  it('applies the limits input at editor creation', () => {
    const fixture = create({ limits: { maxNodes: 7 } });
    expect(fixture.componentInstance.editor()!.limits.maxNodes).toBe(7);
  });

  it('exposes the core event map as signal outputs', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const commits: unknown[] = [];
    const created: string[] = [];
    component.graphChange.subscribe((change) => commits.push(change));
    component.nodeCreated.subscribe(({ node }) => created.push(node.id));

    component.editor()!.transact(() => {
      component.editor()!.execute(
        commands.nodeAdd({ id: 'x', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
      );
      component.editor()!.execute(
        commands.nodeAdd({ id: 'y', position: { x: 30, y: 0 }, size: { width: 10, height: 10 } }),
      );
    });
    expect(commits).toHaveLength(1); // one graph.change per transaction
    expect(created).toEqual(['x', 'y']);
  });

  it('updates state signals zonelessly through the whole wiring', () => {
    const fixture = create({ document: makeDocument() });
    const component = fixture.componentInstance;
    component.engine()!.selection.set(['a']);
    expect(component.selection()).toEqual(['a']);
    component.host()!.viewport.panBy(5, 5);
    expect(component.viewport()).toEqual({ x: 5, y: 5, zoom: 1 });
    component.editor()!.execute(commands.nodeRemove('a'));
    expect(component.nodes().map((n) => n.id)).toEqual(['b']);
    expect(component.canUndo()).toBe(true);
  });

  it('tears everything down on destroy (leak test)', () => {
    const fixture = create({ document: makeDocument() });
    const component = fixture.componentInstance;
    const editor = component.editor()!;
    const canvas = fixture.nativeElement.querySelector('.graphloom-canvas') as HTMLElement;
    expect(canvas.querySelector('svg')).toBeTruthy(); // renderer mounted

    const nodesBefore = component.nodes();
    fixture.destroy();
    expect(component.ready()).toBe(false);
    expect(canvas.querySelector('svg')).toBeNull(); // renderer unmounted
    editor.execute(
      commands.nodeAdd({ id: 'late', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
    );
    expect(component.nodes()).toEqual([]); // parts released
    expect(nodesBefore.map((n) => n.id).sort()).toEqual(['a', 'b']); // bridge frozen, no late updates
  });
});
