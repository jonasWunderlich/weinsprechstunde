import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Wine } from '../../models/wine.model';
import { FilterService } from '../../services/filter.service';
import { DialogService } from '../../services/dialog.service';
import { WineListItemComponent } from './wine-list-item/wine-list-item';

@Component({
  selector: 'app-wine-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineListItemComponent],
  templateUrl: './wine-list.html',
  styleUrl: './wine-list.scss',
})
export class WineListComponent implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly fs = inject(FilterService);
  readonly dialog = inject(DialogService);

  readonly PAGE_SIZE = 24;
  readonly visibleCount = signal(this.PAGE_SIZE);

  readonly allWines = this.fs.filteredWines;
  readonly visibleWines = computed(() => this.allWines().slice(0, this.visibleCount()));
  readonly showBackButton = this.fs.hasActiveFilter;
  readonly isEmpty = computed(() => this.allWines().length === 0);

  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private observer?: IntersectionObserver;

  constructor() {
    effect(() => {
      this.allWines();
      this.visibleCount.set(this.PAGE_SIZE);
    });
    effect(() => {
      const el = this.sentinel()?.nativeElement;
      this.observe(el);
    });
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  ngAfterViewInit(): void {
    this.observe(this.sentinel()?.nativeElement);
  }

  private observe(el: HTMLElement | undefined): void {
    this.observer?.disconnect();
    if (!el || typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.onSentinelVisible();
    });
    this.observer.observe(el);
  }

  onSentinelVisible(): void {
    this.visibleCount.update((n) => Math.min(n + this.PAGE_SIZE, this.allWines().length));
  }

  openDetail(w: Wine): void {
    this.dialog.open(w);
  }

  goBack(): void {
    this.fs.clearAllFilters();
    this.router.navigate(['/']);
  }
}
