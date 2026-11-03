import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorShellComponent } from './editor-shell';
import { FileSystemAccessService } from '../../services/file-system-access.service';
import { EditorStateService } from '../../services/editor-state.service';

/** Zeichnet selectRelative-Aufrufe auf; apiSupported=false verhindert das Auto-Restore. */
class FakeState {
  deltas: number[] = [];
  selectRelative(delta: number): void {
    this.deltas.push(delta);
  }
}

class FakeFsa {
  apiSupported = false; // kein Auto-Restore im Konstruktor
  private access = true;
  hasAccess(): boolean {
    return this.access;
  }
  setAccess(v: boolean): void {
    this.access = v;
  }
  directoryName() {
    return '';
  }
}

function make(): { comp: EditorShellComponent; state: FakeState; fsa: FakeFsa } {
  const state = new FakeState();
  const fsa = new FakeFsa();
  TestBed.configureTestingModule({
    providers: [
      { provide: EditorStateService, useValue: state },
      { provide: FileSystemAccessService, useValue: fsa },
    ],
  });
  const comp = TestBed.runInInjectionContext(() => new EditorShellComponent());
  return { comp, state: state as unknown as FakeState, fsa };
}

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: init.key, cancelable: true });
  // target/modifier über defineProperty setzen (readonly auf KeyboardEvent).
  if (init.target) Object.defineProperty(ev, 'target', { value: init.target });
  for (const m of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    if (init[m]) Object.defineProperty(ev, m, { value: true });
  }
  return ev;
}

describe('EditorShellComponent Pfeiltasten-Navigation', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('ArrowDown/ArrowUp navigieren in der Liste', () => {
    const { comp, state } = make();
    comp.onKeydown(key({ key: 'ArrowDown' }));
    comp.onKeydown(key({ key: 'ArrowUp' }));
    expect(state.deltas).toEqual([1, -1]);
  });

  it('ignoriert Pfeiltasten in Eingabefeldern', () => {
    const { comp, state } = make();
    const input = document.createElement('input');
    comp.onKeydown(key({ key: 'ArrowDown', target: input }));
    expect(state.deltas).toEqual([]);
  });

  it('ignoriert Pfeiltasten mit Modifier', () => {
    const { comp, state } = make();
    comp.onKeydown(key({ key: 'ArrowDown', ctrlKey: true }));
    comp.onKeydown(key({ key: 'ArrowUp', metaKey: true }));
    expect(state.deltas).toEqual([]);
  });

  it('navigiert nicht ohne Ordner-Zugriff', () => {
    const { comp, state, fsa } = make();
    fsa.setAccess(false);
    comp.onKeydown(key({ key: 'ArrowDown' }));
    expect(state.deltas).toEqual([]);
  });

  it('reagiert nur auf Pfeiltasten (andere Tasten ignoriert)', () => {
    const { comp, state } = make();
    comp.onKeydown(key({ key: 'a' }));
    comp.onKeydown(key({ key: 'Enter' }));
    expect(state.deltas).toEqual([]);
  });
});
