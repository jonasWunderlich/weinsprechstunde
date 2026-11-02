import { Routes } from '@angular/router';
import { WineWallComponent } from './components/wine-wall/wine-wall';

export const routes: Routes = [
  { path: '', component: WineWallComponent },
  { path: 'region/:slug', component: WineWallComponent, data: { navType: 'region' } },
  { path: 'rebsorte/:slug', component: WineWallComponent, data: { navType: 'rebsorte' } },
  { path: '**', redirectTo: '' },
];
