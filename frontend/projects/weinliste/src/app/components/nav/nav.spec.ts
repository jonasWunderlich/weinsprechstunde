import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavComponent } from './nav';
import { FilterService } from '@weinsprechstunde/shared';

describe('NavComponent', () => {
  function setup() {
    const fsMock = {
      clearAllFilters: vi.fn(),
    };
    const router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
      imports: [NavComponent],
      providers: [
        { provide: FilterService, useValue: fsMock },
        { provide: Router, useValue: router },
      ],
    });
    const fixture = TestBed.createComponent(NavComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, fsMock, router };
  }

  it('zeigt den App-Namen', () => {
    const { fixture } = setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Weinsprechstunde');
  });

  it('goHome ruft clearAllFilters und navigiert auf /', () => {
    const { c, fsMock, router } = setup();
    c.goHome();
    expect(fsMock.clearAllFilters).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
