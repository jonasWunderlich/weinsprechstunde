import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumWall } from './album-wall';

describe('AlbumWall', () => {
  let component: AlbumWall;
  let fixture: ComponentFixture<AlbumWall>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumWall],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumWall);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
