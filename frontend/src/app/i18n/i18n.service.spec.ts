import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  I18nService, LANGUAGE_STORAGE, LANGUAGE_STORAGE_KEY, TRANSLATIONS,
  type LocalizedMessage, type TranslationKey
} from './i18n.service';

describe('UI language preference and messages', () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  let originalLang: string;
  let originalTitle: string;
  beforeEach(() => {
    originalLang = document.documentElement.lang;
    originalTitle = document.title;
    values = new Map();
    storage = {
      getItem: vi.fn(key => values.get(key) ?? null),
      setItem: vi.fn((key, value) => { values.set(key, value); })
    };
    TestBed.configureTestingModule({ providers: [{ provide: LANGUAGE_STORAGE, useValue: storage }] });
  });
  afterEach(() => {
    document.documentElement.lang = originalLang;
    document.title = originalTitle;
    vi.restoreAllMocks();
  });

  it('defaults to French without writing storage or session data', () => {
    const service = TestBed.inject(I18nService);
    expect(service.lang()).toBe('fr');
    expect(service.t('app.title')).toBe('Planification des auditions');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('fr');
  });

  it('restores a supported preference and updates language and title', () => {
    values.set(LANGUAGE_STORAGE_KEY, 'de');
    const service = TestBed.inject(I18nService);
    expect(service.lang()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.title).toBe('Anhörungsplanung');
    service.setLanguage('it');
    expect(values.get(LANGUAGE_STORAGE_KEY)).toBe('it');
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(LANGUAGE_STORAGE_KEY, 'it');
    expect(document.title).toBe('Pianificazione delle audizioni');
    expect(document.documentElement.lang).toBe('it');
  });

  it('rejects unsupported saved and requested languages', () => {
    values.set(LANGUAGE_STORAGE_KEY, 'unsupported');
    const service = TestBed.inject(I18nService);
    expect(service.lang()).toBe('fr');
    service.setLanguage('en');
    expect(service.lang()).toBe('fr');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('still changes language in memory when storage access throws', () => {
    TestBed.overrideProvider(LANGUAGE_STORAGE, {
      useValue: {
        getItem: () => { throw new Error('Storage blocked'); },
        setItem: () => { throw new Error('Storage blocked'); }
      }
    });
    const service = TestBed.inject(I18nService);
    expect(service.lang()).toBe('fr');
    expect(() => service.setLanguage('de')).not.toThrow();
    expect(service.t('login.title')).toBe('Lokale Anmeldung');
  });

  it('works without a storage implementation', () => {
    TestBed.overrideProvider(LANGUAGE_STORAGE, { useValue: null });
    const service = TestBed.inject(I18nService);
    service.setLanguage('it');
    expect(service.lang()).toBe('it');
  });

  it('renders the same message in the newly selected language without modifying its parameters', () => {
    const service = TestBed.inject(I18nService);
    const value: LocalizedMessage = { key: 'home.confirmed', params: { message: '<fictitious>$&{label}' } };
    expect(service.message(value)).toBe('Accès à l’API confirmé : <fictitious>$&{label}');
    service.setLanguage('de');
    expect(service.message(value)).toBe('API-Zugriff bestätigt: <fictitious>$&{label}');
    service.setLanguage('it');
    expect(service.message(value)).toBe('Accesso all’API confermato: <fictitious>$&{label}');
    expect(value.params?.['message']).toBe('<fictitious>$&{label}');
    expect(service.message(null)).toBe('');
  });

  it('provides complete catalogues with identical nonempty keys and placeholders', () => {
    const keys = Object.keys(TRANSLATIONS.fr).sort() as TranslationKey[];
    const placeholders = (value: string): string[] =>
      Array.from(value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), match => match[1]).sort();
    for (const language of ['de', 'it'] as const) {
      expect(Object.keys(TRANSLATIONS[language]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(TRANSLATIONS[language][key].trim().length).toBeGreaterThan(0);
        expect(placeholders(TRANSLATIONS[language][key])).toEqual(placeholders(TRANSLATIONS.fr[key]));
      }
    }
  });
});
