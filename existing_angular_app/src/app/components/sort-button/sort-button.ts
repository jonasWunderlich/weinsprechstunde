import { Component, Input } from '@angular/core';
import { SortDirection } from '../types';

@Component({
  selector: 'app-sort-button',
  imports: [],
  templateUrl: './sort-button.html',
  styleUrl: './sort-button.scss',
})
export class SortButton {
  @Input() active = false;
  @Input() direction?: SortDirection;
  @Input() label = '';
}
