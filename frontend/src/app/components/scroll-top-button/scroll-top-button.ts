import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

/** Fixierter „nach oben"-Button, erscheint ab window.scrollY > 600. */
@Component({
  selector: 'app-scroll-top-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scroll-top-button.html',
  styleUrl: './scroll-top-button.scss',
})
export class ScrollTopButtonComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly visible = signal(false);

  constructor() {
    const onScroll = () => this.visible.set(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // Initialzustand
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
