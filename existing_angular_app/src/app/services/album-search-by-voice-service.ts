import { httpResource } from '@angular/common/http';
import { Service, signal } from '@angular/core';
import { environment } from '../../environments/environment.dev';

@Service()
export class AlbumSearchByVoiceService {
  private readonly apiUrl = `${environment.apiBasePath}/search-voice`;

  public searchQuery = signal<string>('');

  // httpResource feuert automatisch einen POST-Request, 
  // sobald sich der Wert von searchQuery() ändert und nicht leer ist.
  public searchResult = httpResource(() => {
    const query = this.searchQuery();
    if (!query) return undefined;

    return {
      url: this.apiUrl,
      method: 'POST' as const,
      body: { query }
    };
  });

  // Methode zum Auslösen der Suche
  public triggerSearch(text: string): void {
    this.searchQuery.set(text);
  }
}
