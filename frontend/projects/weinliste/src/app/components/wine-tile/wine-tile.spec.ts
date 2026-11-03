import { ComponentFixture, TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { WineTileComponent } from './wine-tile';
import { Wine } from '@weinsprechstunde/shared';

function create(wine: Wine): ComponentFixture<WineTileComponent> {
  const fixture = TestBed.createComponent(WineTileComponent);
  fixture.componentRef.setInput('wine', wine);
  fixture.detectChanges();
  return fixture;
}

const W: Wine = { name: 'Test' };

describe('WineTileComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [WineTileComponent] }));

  it('Hover zeigt/versteckt Overlay, wenn InfoToggle aus', () => {
    const f = create(W);
    const c = f.componentInstance;
    expect(c.overlayVisible()).toBe(false);
    c.onMouseEnter();
    expect(c.overlayVisible()).toBe(true);
    c.onMouseLeave();
    expect(c.overlayVisible()).toBe(false);
  });

  it('Play-Button nur bei Medien', () => {
    expect(create(W).componentInstance.hasMedia()).toBe(false);
    expect(create({ name: 'A', audio: 'a.mp3' }).componentInstance.hasMedia()).toBe(true);
    expect(create({ name: 'A', video: 'v.mp4' }).componentInstance.hasMedia()).toBe(true);
  });

  it('Klick bei sichtbarem Overlay emittiert openDetail', () => {
    const f = create(W);
    const c = f.componentInstance;
    let emitted: Wine | undefined;
    c.openDetail.subscribe((w) => (emitted = w));
    c.onMouseEnter(); // overlay sichtbar
    c.onTileClick();
    expect(emitted).toBe(W);
  });

  it('Play emittiert openDetail und stoppt Propagation', () => {
    const f = create({ name: 'A', audio: 'a.mp3' });
    const c = f.componentInstance;
    let emitted: Wine | undefined;
    c.openDetail.subscribe((w) => (emitted = w));
    const e = { stopPropagation: vi.fn() } as unknown as Event;
    c.onPlay(e);
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(emitted?.name).toBe('A');
  });

  // Feature: weinliste, Property 12: InfoToggle wirkt auf alle Kacheln — bei showInfos=true ist
  // overlayVisible immer true, unabhängig vom lokalen Hover/Tap-Zustand.
  it('Property 12: showInfos=true erzwingt overlayVisible', () => {
    fc.assert(
      fc.property(fc.boolean(), (hovered) => {
        const f = create(W);
        const c = f.componentInstance;
        f.componentRef.setInput('showInfos', true);
        if (hovered) c.onMouseEnter();
        f.detectChanges();
        expect(c.overlayVisible()).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: weinliste, Property 13: InfoToggle-Roundtrip — nach true→false bestimmt allein der
  // lokale Zustand die Sichtbarkeit (overlayVisible === localOverlay).
  it('Property 13: Roundtrip true→false stellt lokalen Zustand wieder her', () => {
    fc.assert(
      fc.property(fc.boolean(), (hovered) => {
        const f = create(W);
        const c = f.componentInstance;
        // lokalen Zustand setzen bei ausgeschaltetem InfoToggle
        if (hovered) c.onMouseEnter();
        const localBefore = c.overlayVisible();
        f.componentRef.setInput('showInfos', true);
        f.detectChanges();
        f.componentRef.setInput('showInfos', false);
        f.detectChanges();
        expect(c.overlayVisible()).toBe(localBefore);
      }),
      { numRuns: 100 },
    );
  });
});
