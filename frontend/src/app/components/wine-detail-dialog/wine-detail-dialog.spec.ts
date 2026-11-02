import { ComponentFixture, TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { WineDetailDialogComponent } from './wine-detail-dialog';
import { Wine } from '../../models/wine.model';
import { arbitraryWine } from '../../models/test-helpers';
import { isPresent } from '../../models/wine-util';

function render(wine: Wine | null): ComponentFixture<WineDetailDialogComponent> {
  const fixture = TestBed.createComponent(WineDetailDialogComponent);
  fixture.componentRef.setInput('wine', wine);
  fixture.detectChanges();
  return fixture;
}

describe('WineDetailDialogComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [WineDetailDialogComponent] }));
  afterEach(() => (document.body.style.overflow = ''));

  it('rendert nichts bei null', () => {
    const f = render(null);
    expect((f.nativeElement as HTMLElement).querySelector('.dialog-backdrop')).toBeNull();
  });

  it('close-Output bei Schließen-Button', () => {
    const f = render({ name: 'A' });
    let closed = false;
    f.componentInstance.close.subscribe(() => (closed = true));
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.dialog-close')!.click();
    expect(closed).toBe(true);
  });

  it('Backdrop-Klick schließt nur bei Backdrop-Target', () => {
    const f = render({ name: 'A' });
    const c = f.componentInstance;
    let closed = 0;
    c.close.subscribe(() => closed++);
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    c.onBackdropClick({ target: backdrop } as unknown as MouseEvent);
    const inner = document.createElement('div');
    c.onBackdropClick({ target: inner } as unknown as MouseEvent);
    expect(closed).toBe(1);
  });

  it('Body-Scroll-Lock setzt/zurücksetzt overflow', () => {
    const f = render({ name: 'A' });
    expect(document.body.style.overflow).toBe('hidden');
    f.componentRef.setInput('wine', null);
    f.detectChanges();
    expect(document.body.style.overflow).toBe('');
  });

  it('extraEntries enthält genau die unbekannten, gesetzten Felder', () => {
    const f = render({ name: 'A', taste_eye: 'gelb', percentage: '', country: 'DE' } as Wine);
    const keys = f.componentInstance.extraEntries().map((e) => e.key);
    expect(keys).toContain('taste_eye');
    expect(keys).not.toContain('percentage'); // leerer String
    expect(keys).not.toContain('country'); // bekanntes Feld
  });

  // Feature: weinliste, Property 16: WineDetailDialog Feldvollständigkeit — jedes im Objekt
  // gesetzte Feld (bekannt + unbekannt) ist über seinen data-field-Anker im DOM nachweisbar.
  it('Property 16: jedes gesetzte Feld ist im DOM nachweisbar', () => {
    const anchored = [
      'name',
      'producer',
      'year',
      'rating',
      'country',
      'origin',
      'grape',
      'type',
      'quality',
      'tasting_date',
      'description',
      'price',
      'image',
      'audio',
      'video',
    ];
    fc.assert(
      fc.property(arbitraryWine(), (wine) => {
        const f = render(wine);
        const el = f.nativeElement as HTMLElement;
        for (const [key, value] of Object.entries(wine)) {
          if (!isPresent(value)) continue;
          if (anchored.includes(key) || !isKnown(key)) {
            const node = el.querySelector(`[data-field="${cssEscape(key)}"]`);
            expect(node, `Feld ${key} fehlt im DOM`).not.toBeNull();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

const KNOWN = new Set([
  'name',
  'producer',
  'year',
  'rating',
  'country',
  'origin',
  'grape',
  'type',
  'quality',
  'tasting_date',
  'description',
  'price',
  'image',
  'audio',
  'video',
]);
function isKnown(k: string): boolean {
  return KNOWN.has(k);
}
function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}
