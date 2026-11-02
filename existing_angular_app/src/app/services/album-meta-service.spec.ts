import { TestBed } from '@angular/core/testing';

import { AlbumMetaService } from './album-meta-service';

describe('AlbumMetaService', () => {
  let service: AlbumMetaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AlbumMetaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
