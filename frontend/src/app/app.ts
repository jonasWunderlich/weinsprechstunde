import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WineDataService } from './services/wine-data.service';
import { DialogService } from './services/dialog.service';
import { NavComponent } from './components/nav/nav';
import { WineDetailDialogComponent } from './components/wine-detail-dialog/wine-detail-dialog';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavComponent, RouterOutlet, WineDetailDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly dataService = inject(WineDataService);
  readonly dialog = inject(DialogService);

  ngOnInit(): void {
    this.dataService.loadAll();
  }
}
