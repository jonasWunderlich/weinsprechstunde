import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { WineTileOverlayComponent } from './wine-tile-overlay';
import { grapeList, isPresent, Wine } from '@weinsprechstunde/shared';

const OVERLAY_FIELDS = ['rating', 'year', 'name', 'producer', 'grape', 'origin'] as const;

function render(wine: Wine): HTMLElement {
  const fixture = TestBed.createComponent(WineTileOverlayComponent);
  fixture.componentRef.setInput('wine', wine);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('WineTileOverlayComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [WineTileOverlayComponent] }));

  it('zeigt nur gesetzte Felder, keine leeren Labels', () => {
    const el = render({ name: 'Wein', origin: 'Rheingau' });
    expect(el.querySelector('[data-field="name"]')).not.toBeNull();
    expect(el.querySelector('[data-field="origin"]')).not.toBeNull();
    expect(el.querySelector('[data-field="rating"]')).toBeNull();
    expect(el.querySelector('[data-field="producer"]')).toBeNull();
  });

  // Feature: weinliste, Property 15: WineTileOverlay Datenvollständigkeit — für jede Teilmenge
  // gesetzter Overlay-Felder erscheinen genau die vorhandenen, keine leeren.
  it('Property 15: Overlay zeigt exakt die vorhandenen Overlay-Felder', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.constant('Wein'),
          year: fc.option(fc.integer({ min: 1990, max: 2024 }), { nil: null }),
          producer: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null }),
          origin: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null }),
          rating: fc.option(fc.float({ min: 1, max: 10, noNaN: true }), { nil: null }),
          grape: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 2 }), {
            nil: null,
          }),
        }),
        (raw) => {
          const wine = raw as unknown as Wine;
          const el = render(wine);
          for (const field of OVERLAY_FIELDS) {
            const present =
              field === 'grape' ? grapeList(wine).length > 0 : isPresent(wine[field]);
            const node = el.querySelector(`[data-field="${field}"]`);
            expect(!!node).toBe(present);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
