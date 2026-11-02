import { Routes } from '@angular/router';
import { WineWallComponent } from './components/wine-wall/wine-wall';

export const routes: Routes = [
  { path: '', component: WineWallComponent },
  { path: '**', redirectTo: '' },
];
