import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlsRow } from './controls-row';

describe('ControlsRow', () => {
  let component: ControlsRow;
  let fixture: ComponentFixture<ControlsRow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlsRow],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlsRow);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
