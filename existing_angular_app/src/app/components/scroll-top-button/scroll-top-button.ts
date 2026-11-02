import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal,
} from '@angular/core';
@Component({
  selector: 'app-scroll-top-button',
  imports: [],
  templateUrl: './scroll-top-button.html',
  styleUrl: './scroll-top-button.scss',
})
export class ScrollTopButton {
  readonly isVisible = signal(false);
  @Input() showInfos = true;
  @Output() showInfosChange = new EventEmitter<boolean>();

  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    const scrollPosition =
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    this.isVisible.set(scrollPosition > 2000);
  }

  scrollToTop(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }
}
