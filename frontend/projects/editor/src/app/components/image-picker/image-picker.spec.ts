import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ImagePickerComponent } from './image-picker';
import {
  DirectoryHandleStore,
  FileSystemAccessService,
  ImageEntry,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
} from '../../services/file-system-access.service';

function img(name: string, date: number, assigned: boolean, path = name): ImageEntry {
  return { name, path, dirSegments: [], date, dateSource: 'lastModified', assigned };
}

// Thumbnails spielen für diese Interaktionstests keine Rolle; die EntryThumbnail-
// Komponente nutzt den FileSystemAccessService, daher stellen wir triviale Fakes der
// Adapter-Tokens bereit, die kein echtes Canvas/IndexedDB/FSA benötigen.
class NoopStore {
  async save(): Promise<void> {}
  async load(): Promise<null> {
    return null;
  }
  async clear(): Promise<void> {}
}
class NoopRenderer {
  async render(): Promise<never> {
    // wird in diesen Tests nie aufgerufen (kein Pfad geladen)
    throw new Error('not used');
  }
}

function setup(images: ImageEntry[], selected = ''): {
  fixture: ReturnType<typeof TestBed.createComponent<ImagePickerComponent>>;
  component: ImagePickerComponent;
  el: HTMLElement;
} {
  TestBed.configureTestingModule({
    imports: [ImagePickerComponent],
    providers: [
      FileSystemAccessService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: null },
      { provide: DirectoryHandleStore, useClass: NoopStore },
      { provide: ThumbnailRenderer, useClass: NoopRenderer },
    ],
  });
  const fixture = TestBed.createComponent(ImagePickerComponent);
  fixture.componentRef.setInput('images', images);
  fixture.componentRef.setInput('selected', selected);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, el: fixture.nativeElement };
}

describe('ImagePickerComponent', () => {
  const sample = [
    img('alpha.jpg', 300, false),
    img('beta.png', 100, true),
    img('gamma.webp', 200, false),
  ];

  it('zeigt standardmäßig nur ungenutzte Bilder (Req 17.28)', () => {
    const { component } = setup(sample);
    expect(component.showAll()).toBe(false);
    expect(component.visibleImages().map((i) => i.name).sort()).toEqual(['alpha.jpg', 'gamma.webp']);
  });

  it('schaltet per Button auf alle Bilder um (Req 17.29)', () => {
    const { component, el, fixture } = setup(sample);
    (el.querySelector('[data-testid="image-picker-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.showAll()).toBe(true);
    expect(component.visibleImages().length).toBe(3);
  });

  it('schaltet die Datum-Sortierung um (Req 17.30)', () => {
    const { component, el, fixture } = setup(sample);
    component.showAll.set(true);
    fixture.detectChanges();
    expect(component.visibleImages().map((i) => i.name)).toEqual(['alpha.jpg', 'gamma.webp', 'beta.png']);
    (el.querySelector('[data-testid="image-picker-sort"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.visibleImages().map((i) => i.name)).toEqual(['beta.png', 'gamma.webp', 'alpha.jpg']);
  });

  it('filtert nach Dateiname (Req 17.31)', () => {
    const { component } = setup(sample);
    component.setFilter('GAMM');
    expect(component.visibleImages().map((i) => i.name)).toEqual(['gamma.webp']);
  });

  it('emittiert bei Auswahl den Dateinamen ohne Pfad (Req 17.34/17.35)', () => {
    const images = [img('wein.jpg', 300, false, 'unterordner/wein.jpg')];
    const { component } = setup(images);
    const spy = vi.fn();
    component.pick.subscribe(spy);
    component.select(images[0]);
    expect(spy).toHaveBeenCalledWith('wein.jpg');
  });
});
