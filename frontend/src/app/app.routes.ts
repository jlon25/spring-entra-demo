import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginComponent } from './login.component';
import { HomeComponent } from './home.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Connexion locale' },
  { path: 'accueil', component: HomeComponent, canActivate: [authGuard], title: 'Accueil' },
  {
    path: 'types-audition',
    loadComponent: () => import('./hearing-types/hearing-types.component').then(module => module.HearingTypesComponent),
    canActivate: [authGuard],
    title: 'Types d’audition'
  },
  { path: '', redirectTo: 'accueil', pathMatch: 'full' },
  { path: '**', redirectTo: 'accueil' }
];
