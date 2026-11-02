import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumListItem } from './album-list-item';

describe('AlbumListItem', () => {
  let component: AlbumListItem;
  let fixture: ComponentFixture<AlbumListItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumListItem],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumListItem);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
