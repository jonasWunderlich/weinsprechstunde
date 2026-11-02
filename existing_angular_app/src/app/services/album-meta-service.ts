import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import { YearsAndDecadesResponse } from '../api/model/yearsAndDecadesResponse';
import { environment } from '../../environments/environment.dev';

@Service()
export class AlbumMetaService {
  private readonly apiUrl = `${environment.apiBasePath}/yearsAndDecades`;

  data = httpResource<YearsAndDecadesResponse>(
    () => {
      return this.apiUrl;
    },
    {
      defaultValue: { releaseYears: [], decades: [] },
    },
  );
}
