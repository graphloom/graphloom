import { Component, provideZonelessChangeDetection, viewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { commands } from '@graphloom/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphComponent } from './graph.component.js';
import { GraphNodeTemplateDirective } from './overlay.js';

@Component({
  imports: [GraphComponent, GraphNodeTemplateDirective],
  template: `
    <graphloom-graph>
      <ng-template graphloomNode="card" let-node>
        <span class="card-overlay">{{ node.id }}</span>
      </ng-template>
    </graphloom-graph>
  `,
})
class HostComponent {
  readonly graph = viewChild.required(GraphComponent);
}

const addCard = (fixture: ComponentFixture<HostComponent>, id: string, x: number, y: number): void => {
  fixture.componentInstance.graph().editor()!.execute(
    commands.nodeAdd({ id, type: 'card', position: { x, y }, size: { width: 80, height: 40 } }),
  );
};

const overlayEls = (fixture: ComponentFixture<HostComponent>): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.graphloom-overlay-node'),
];

describe('Tier-2 overlay templates (P5-T04, ADR-0003)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.tick();
    // jsdom hosts have zero size; give the viewport a real one for culling.
    fixture.componentInstance.graph().host()!.viewport.setSize({ width: 800, height: 600 });
  });

  it('stamps the template for nodes of its type, positioned by core math', () => {
    addCard(fixture, 'in-view', 100, 100);
    fixture.componentInstance.graph().editor()!.execute(
      commands.nodeAdd({ id: 'plain', position: { x: 200, y: 100 }, size: { width: 80, height: 40 } }),
    );
    fixture.detectChanges();

    const els = overlayEls(fixture);
    expect(els).toHaveLength(1); // only the typed node gets an overlay
    expect(els[0]!.dataset['nodeId']).toBe('in-view');
    expect(els[0]!.textContent).toContain('in-view');
    expect(els[0]!.style.transform).toBe('translate(100px, 100px) scale(1)');
    expect(els[0]!.style.width).toBe('80px');
  });

  it('stays pixel-locked to the canvas across pan and zoom', () => {
    addCard(fixture, 'n1', 100, 100);
    const viewport = fixture.componentInstance.graph().host()!.viewport;
    viewport.setViewport({ x: 40, y: 10, zoom: 2 });
    fixture.detectChanges();
    const screen = viewport.worldToScreen({ x: 100, y: 100 });
    expect(overlayEls(fixture)[0]!.style.transform).toBe(
      `translate(${screen.x}px, ${screen.y}px) scale(2)`,
    );
  });

  it('virtualizes: off-viewport overlay components are destroyed', () => {
    addCard(fixture, 'near', 100, 100);
    addCard(fixture, 'far', 5000, 5000);
    fixture.detectChanges();
    expect(overlayEls(fixture).map((el) => el.dataset['nodeId'])).toEqual(['near']);

    // Pan to the far node: it mounts, the near one is destroyed.
    const viewport = fixture.componentInstance.graph().host()!.viewport;
    viewport.setViewport({ x: -4800, y: -4800, zoom: 1 });
    fixture.detectChanges();
    expect(overlayEls(fixture).map((el) => el.dataset['nodeId'])).toEqual(['far']);
  });

  it('types template contexts via the static context guard', () => {
    const directive = null as unknown as GraphNodeTemplateDirective;
    expect(GraphNodeTemplateDirective.ngTemplateContextGuard(directive, {})).toBe(true);
  });

  it('unmounts overlays for hidden or deleted nodes', () => {
    addCard(fixture, 'n1', 100, 100);
    fixture.detectChanges();
    expect(overlayEls(fixture)).toHaveLength(1);
    fixture.componentInstance.graph().editor()!.execute(commands.nodeRemove('n1'));
    fixture.detectChanges();
    expect(overlayEls(fixture)).toHaveLength(0);
  });
});
