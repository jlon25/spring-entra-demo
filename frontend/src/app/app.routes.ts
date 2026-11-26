import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginComponent } from './login.component';
import { HomeComponent } from './home.component';

// I18nService owns the translated application title. Static route titles would
// overwrite it after navigation or a reload, independently of the selected language.
export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'accueil', component: HomeComponent, canActivate: [authGuard] },
  {
    path: 'types-audition',
    loadComponent: () => import('./hearing-types/hearing-types.component').then(module => module.HearingTypesComponent),
    canActivate: [authGuard]
  },
  { path: '', redirectTo: 'accueil', pathMatch: 'full' },
  { path: '**', redirectTo: 'accueil' }
];
