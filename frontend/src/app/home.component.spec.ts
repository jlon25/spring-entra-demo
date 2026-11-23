import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HomeComponent } from './home.component';

describe('Protected API feedback', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('displays successful API access without showing a token', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    await fixture.whenStable();
    fixture.componentInstance.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message').flush({ message: 'authenticated' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent)
      .toContain('Accès à l’API confirmé : authenticated');
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('explains insufficient permissions distinctly from a network error', () => {
    const component = TestBed.createComponent(HomeComponent).componentInstance;
    component.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(component.error()).toBe('Votre session est valide, mais les droits sont insuffisants.');
    expect(component.message()).toBe('');
    component.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message').error(new ProgressEvent('error'));
    expect(component.error()).toContain('L’API est inaccessible');
  });
});
