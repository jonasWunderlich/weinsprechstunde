import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorStateService } from '../../services/editor-state.service';
import { EntryTypeFilter } from '../../models/editor-list.model';

/**
 * Editor-spezifischer dreiwertiger Eintragstyp-Filter „Alle" / „Nur angelegte" /
 * „Nur unbekannte" (Req 17.14). Liegt bewusst in der `editor`-App, nicht in der
 * geteilten Library (Req 17.11).
 */
@Component({
  selector: 'app-entry-type-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entry-type-filter.html',
  styleUrl: './entry-type-filter.scss',
})
export class EntryTypeFilterComponent {
  readonly state = inject(EditorStateService);

  readonly options: { value: EntryTypeFilter; label: string }[] = [
    { value: 'all', label: 'Alle' },
    { value: 'created', label: 'Nur angelegte' },
    { value: 'unknown', label: 'Nur unbekannte' },
  ];

  select(value: EntryTypeFilter): void {
    this.state.setEntryType(value);
  }
}
