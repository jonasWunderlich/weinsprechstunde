import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumTileFilterLink } from './album-tile-filter-link';

describe('AlbumTileFilterLink', () => {
  let component: AlbumTileFilterLink;
  let fixture: ComponentFixture<AlbumTileFilterLink>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumTileFilterLink],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumTileFilterLink);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
