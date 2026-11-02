import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumTileCover } from './album-tile-cover';

describe('AlbumTileCover', () => {
  let component: AlbumTileCover;
  let fixture: ComponentFixture<AlbumTileCover>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumTileCover],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumTileCover);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
