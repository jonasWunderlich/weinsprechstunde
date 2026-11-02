import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NavActiveFilter } from './nav-active-filter';

describe('NavActiveFilter', () => {
  let component: NavActiveFilter;
  let fixture: ComponentFixture<NavActiveFilter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavActiveFilter],
    }).compileComponents();

    fixture = TestBed.createComponent(NavActiveFilter);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
