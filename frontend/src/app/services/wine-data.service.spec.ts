import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { WineDataService } from './wine-data.service';

describe('WineDataService', () => {
  let service: WineDataService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WineDataService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WineDataService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('idle → loading → loaded bei erfolgreichem forkJoin (beide Assets)', () => {
    expect(service.loadState()).toBe('idle');
    service.loadAll();
    expect(service.loadState()).toBe('loading');

    const wReq = httpMock.expectOne('assets/wines.json');
    const sReq = httpMock.expectOne('assets/wine-schema.json');
    wReq.flush([{ name: 'A' }]);
    sReq.flush([{ field: 'name', type: 'text', filter_type: 'text-search', default_filter: true }]);

    expect(service.loadState()).toBe('loaded');
    expect(service.wines().length).toBe(1);
    expect(service.schema().length).toBe(1);
  });

  it('loading → error bei HTTP-Fehler eines Requests', () => {
    service.loadAll();
    const wReq = httpMock.expectOne('assets/wines.json');
    const sReq = httpMock.expectOne('assets/wine-schema.json');
    wReq.flush('nope', { status: 500, statusText: 'err' });
    // forkJoin bricht den Parallel-Request ab; die Testbackend-Anfrage sauber abschließen.
    if (!sReq.cancelled) sReq.flush([]);
    expect(service.loadState()).toBe('error');
  });

  it('zweiter loadAll() ist No-op', () => {
    service.loadAll();
    httpMock.expectOne('assets/wines.json').flush([]);
    httpMock.expectOne('assets/wine-schema.json').flush([]);
    expect(service.loadState()).toBe('loaded');
    service.loadAll();
    httpMock.expectNone('assets/wines.json');
  });
});
