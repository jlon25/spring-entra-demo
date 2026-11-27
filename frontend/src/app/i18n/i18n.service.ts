import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { commonTranslations } from './common-translations';
import { hearingTranslations } from '../hearing-types/hearing-translations';

export type Language = 'fr' | 'de' | 'it';
export const LANGUAGE_STORAGE_KEY = 'auditions.ui.language';
export const LANGUAGE_STORAGE = new InjectionToken<Pick<Storage, 'getItem' | 'setItem'> | null>(
  'UI language preference storage', {
    providedIn: 'root',
    factory: () => {
      try { return inject(DOCUMENT).defaultView?.localStorage ?? null; }
      catch { return null; }
    }
  }
);

const fr = { ...commonTranslations.fr, ...hearingTranslations.fr };
export type TranslationKey = keyof typeof fr;
const translations: Record<Language, Record<TranslationKey, string>> = {
  fr, de: { ...commonTranslations.de, ...hearingTranslations.de },
  it: { ...commonTranslations.it, ...hearingTranslations.it }
};
export type TranslationParams = Readonly<Record<string, string | number>>;
export interface LocalizedMessage {
  readonly key: TranslationKey;
  readonly params?: TranslationParams;
}
export const TRANSLATIONS = translations;

function isLanguage(value: unknown): value is Language {
  return value === 'fr' || value === 'de' || value === 'it';
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(LANGUAGE_STORAGE);
  private readonly current = signal<Language>(this.initialLanguage());
  readonly lang = this.current.asReadonly();
  readonly locale = computed(() => ({ fr: 'fr-CH', de: 'de-CH', it: 'it-CH' })[this.current()]);

  constructor() { this.updateDocument(); }

  setLanguage(value: string): void {
    if (!isLanguage(value)) return;
    this.current.set(value);
    // This key contains only a language code, never credentials or session data.
    try { this.storage?.setItem(LANGUAGE_STORAGE_KEY, value); } catch { /* In-memory selection still works. */ }
    this.updateDocument();
  }

  t(key: TranslationKey, params: TranslationParams = {}): string {
    const template = translations[this.current()][key] ?? translations.fr[key];
    // A callback prevents replacement characters in user text from being interpreted.
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder: string, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
  }

  message(value: LocalizedMessage | null): string {
    return value ? this.t(value.key, value.params) : '';
  }

  private initialLanguage(): Language {
    try {
      const value = this.storage?.getItem(LANGUAGE_STORAGE_KEY);
      return isLanguage(value) ? value : 'fr';
    } catch { return 'fr'; }
  }

  private updateDocument(): void {
    this.document.documentElement.lang = this.current();
    this.document.title = this.t('app.title');
  }
}
