import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumTile } from './album-tile';

describe('AlbumTile', () => {
  let component: AlbumTile;
  let fixture: ComponentFixture<AlbumTile>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumTile],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumTile);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
