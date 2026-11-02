import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumTileOverlay } from './album-tile-overlay';

describe('AlbumTileOverlay', () => {
  let component: AlbumTileOverlay;
  let fixture: ComponentFixture<AlbumTileOverlay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumTileOverlay],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumTileOverlay);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
