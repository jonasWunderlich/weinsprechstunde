import { TestBed } from '@angular/core/testing';
import { WineDataSource } from '@weinsprechstunde/shared';
import { App } from './app';
import { EditorWineDataService } from './services/editor-wine-data.service';
import {
  DirectoryHandleStore,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
  Thumbnail,
} from './services/file-system-access.service';
import { FsaDirectoryHandle } from './services/fsa-types';

class InMemoryStore extends DirectoryHandleStore {
  override async save(): Promise<void> {}
  override async load(): Promise<FsaDirectoryHandle | null> {
    return null;
  }
  override async clear(): Promise<void> {}
}

class FakeThumbnailRenderer extends ThumbnailRenderer {
  override async render(): Promise<Thumbnail> {
    return { blob: new Blob(), width: 1, height: 1 };
  }
}

describe('Editor App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // Keine File System Access API in jsdom → Editor zeigt den Chromium-Hinweis.
        { provide: SHOW_DIRECTORY_PICKER, useValue: null },
        { provide: DirectoryHandleStore, useValue: new InMemoryStore() },
        { provide: ThumbnailRenderer, useValue: new FakeThumbnailRenderer() },
        { provide: WineDataSource, useExisting: EditorWineDataService },
      ],
    }).compileComponents();
  });

  it('should create the editor root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the Wine Editor heading', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1');
    expect(heading?.textContent).toContain('Wine Editor');
  });

  it('shows the Chromium hint when the File System Access API is unavailable', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Chromium');
  });
});
