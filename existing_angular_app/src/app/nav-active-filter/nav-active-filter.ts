import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Icon } from '../components/icon/icon';

@Component({
  selector: 'app-nav-active-filter',
  imports: [Icon],
  templateUrl: './nav-active-filter.html',
  styleUrl: './nav-active-filter.scss',
})
export class NavActiveFilter {
  @Input() label!: string;
  @Input() filter?: string | number;
  @Output() clickRest = new EventEmitter<boolean>();

  reset() {
    this.clickRest.emit(true);
  }
}
