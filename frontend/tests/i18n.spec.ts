import { expect, test, type Page, type Response } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

const copy = {
  fr: {
    login: 'Connexion locale', username: 'Nom d’utilisateur', password: 'Mot de passe',
    submit: 'Se connecter', invalid: 'Nom d’utilisateur ou mot de passe incorrect.',
    home: 'Accueil', types: 'Types d’audition', title: 'Planification des auditions',
    logout: 'Se déconnecter', checkApi: 'Vérifier l’accès à l’API',
    newType: 'Nouveau type', label: 'Libellé', duration: 'Durée (minutes)',
    pause: 'Pause minimale (minutes)', defender: 'Défenseur requis', save: 'Enregistrer',
    editTitle: 'Modifier un type', confirmDelete: 'Confirmer la suppression',
    cancelDelete: 'Annuler la suppression'
  },
  de: {
    login: 'Lokale Anmeldung', username: 'Benutzername', password: 'Passwort',
    submit: 'Anmelden', invalid: 'Benutzername oder Passwort ist falsch.',
    home: 'Startseite', types: 'Anhörungstypen', title: 'Anhörungsplanung',
    logout: 'Abmelden', checkApi: 'API-Zugriff prüfen',
    newType: 'Neuer Typ', label: 'Bezeichnung', duration: 'Dauer (Minuten)',
    pause: 'Mindestpause (Minuten)', defender: 'Rechtsbeistand erforderlich', save: 'Speichern',
    editTitle: 'Typ bearbeiten', confirmDelete: 'Löschung bestätigen',
    cancelDelete: 'Löschung abbrechen'
  },
  it: {
    login: 'Accesso locale', username: 'Nome utente', password: 'Password',
    submit: 'Accedi', invalid: 'Nome utente o password errati.',
    home: 'Pagina iniziale', types: 'Tipi di audizione', title: 'Pianificazione delle audizioni',
    logout: 'Disconnettersi', checkApi: 'Verifica l’accesso all’API',
    newType: 'Nuovo tipo', label: 'Denominazione', duration: 'Durata (minuti)',
    pause: 'Pausa minima (minuti)', defender: 'Difensore richiesto', save: 'Salva',
    editTitle: 'Modifica un tipo', confirmDelete: 'Conferma eliminazione',
    cancelDelete: 'Annulla eliminazione'
  }
} as const;
type Language = keyof typeof copy;

function editName(language: Language, label: string): string {
  return language === 'de' ? label + ' bearbeiten'
    : language === 'it' ? 'Modifica ' + label : 'Modifier ' + label;
}
function deleteName(language: Language, label: string): string {
  return language === 'de' ? label + ' löschen'
    : language === 'it' ? 'Elimina ' + label : 'Supprimer ' + label;
}

async function changeLanguage(page: Page, language: Language): Promise<void> {
  await page.locator('#language').selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page).toHaveTitle(copy[language].title);
  await expect(page.locator('#language')).toHaveValue(language);
}

async function login(page: Page, language: Language): Promise<void> {
  await page.goto('/login');
  await changeLanguage(page, language);
  const text = copy[language];
  await page.getByLabel(text.username, { exact: true }).fill(username);
  await page.getByLabel(text.password, { exact: true }).fill(password!);
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByRole('heading', { name: text.home, exact: true })).toBeVisible();
}

function writeResponse(page: Page, method: 'POST' | 'PUT' | 'DELETE'): Promise<Response> {
  return page.waitForResponse(response => response.request().method() === method
    && /^\/api\/hearing-types(?:\/[^/]+)?$/.test(new URL(response.url()).pathname));
}

async function sessionExpiry(page: Page): Promise<number> {
  // Return only expiry metadata, never the token or the serialized session.
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem('auditions.auth.session.v1');
    if (raw === null) throw new Error('Expected a stored tab session');
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || !('expiresAt' in value)
        || typeof value.expiresAt !== 'number') throw new Error('Missing session expiry');
    return value.expiresAt;
  });
}

test('translates an existing real login refusal immediately and retains the explicit language after reload', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByLabel(copy.fr.username, { exact: true }).fill(username);
  await page.getByLabel(copy.fr.password, { exact: true }).fill('wrong-disposable-i18n-password');
  const refused = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/identity/token');
  await page.getByRole('button', { name: copy.fr.submit, exact: true }).click();
  expect((await refused).status()).toBe(401);
  for (const language of ['fr', 'de', 'it'] as const) {
    await changeLanguage(page, language);
    await expect(page.getByRole('heading', { name: copy[language].login, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(copy[language].invalid);
    await expect(page.getByLabel(copy[language].password, { exact: true })).toHaveValue('');
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page).toHaveTitle(copy.it.title);
  await expect(page.getByRole('heading', { name: copy.it.login, exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('auditions.ui.language'))).toBe('it');
  expect(await page.evaluate(() => window.sessionStorage.getItem('auditions.auth.session.v1') === null)).toBe(true);
});

test('switches all three languages without another login or extending the session and keeps the preference after logout', async ({ page }) => {
  let tokenRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/identity/token') tokenRequests++;
  });
  await login(page, 'fr');
  const expiresAt = await sessionExpiry(page);
  for (const language of ['fr', 'de', 'it'] as const) {
    const text = copy[language];
    await changeLanguage(page, language);
    await page.getByRole('link', { name: text.types, exact: true }).click();
    await expect(page.getByRole('heading', { name: text.types, exact: true })).toBeVisible();
    await page.getByRole('link', { name: text.home, exact: true }).click();
    await page.getByRole('button', { name: text.checkApi, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('authenticated');
    expect(await sessionExpiry(page)).toBe(expiresAt);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: copy.it.home, exact: true })).toBeVisible();
  expect(await sessionExpiry(page)).toBe(expiresAt);
  expect(tokenRequests).toBe(1);
  // Local storage contains only the UI preference; authentication stays tab-scoped.
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual(['auditions.ui.language']);
  await page.getByRole('button', { name: copy.it.logout, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy.it.login, exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem('auditions.auth.session.v1') === null)).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: copy.it.login, exact: true })).toBeVisible();
  await expect(page.locator('#language')).toHaveValue('it');
});

// These two journeys use the real API, signed local tokens and PostgreSQL.
// User-entered labels are data and must not be translated.
for (const language of ['de', 'it'] as const) {
  test('creates, updates and deletes a hearing type using the ' + language + ' interface', async ({ page }) => {
    const text = copy[language];
    const label = 'Fictitious-i18n-' + language + '-' + Date.now();
    await login(page, language);
    await page.getByRole('link', { name: text.types, exact: true }).click();
    await page.getByRole('button', { name: text.newType, exact: true }).click();
    await page.getByLabel(text.label, { exact: true }).fill(label);
    await page.getByLabel(text.duration, { exact: true }).fill('60');
    await page.getByLabel(text.pause, { exact: true }).fill('0');
    await page.getByLabel(text.defender, { exact: true }).check();
    const created = writeResponse(page, 'POST');
    await page.getByRole('button', { name: text.save, exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();

    await page.getByRole('button', { name: editName(language, label), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(text.editTitle);
    await expect(page.getByLabel(text.label, { exact: true })).toHaveValue(label);
    await expect(page.getByLabel(text.pause, { exact: true })).toHaveValue('0');
    await page.getByLabel(text.duration, { exact: true }).fill('75');
    const updated = writeResponse(page, 'PUT');
    await page.getByRole('button', { name: text.save, exact: true }).click();
    expect((await updated).status()).toBe(200);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page.getByRole('button', { name: editName(language, label), exact: true }).click();
    await expect(page.getByLabel(text.duration, { exact: true })).toHaveValue('75');
    await expect(page.getByLabel(text.label, { exact: true })).toHaveValue(label);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: deleteName(language, label), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: text.cancelDelete, exact: true })).toBeFocused();
    const deleted = writeResponse(page, 'DELETE');
    await page.getByRole('button', { name: text.confirmDelete, exact: true }).click();
    expect((await deleted).status()).toBe(204);
    await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeHidden();
  });
}

test('keeps the language selector and named mobile icon actions usable at 320px in every language', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env['FRONTEND_BASE_URL'] ?? 'http://127.0.0.1:4200',
    viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();
  const label = 'Fictitious-localized-mobile-label';
  try {
    // Only the list is simulated here to isolate layout from persisted test data.
    await page.route('**/api/hearing-types', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{
          id: 'localized-mobile-ui-only', label, durationMinutes: 60,
          pauseMinutes: 0, defenderRequired: false, version: 0
        }] });
      } else await route.continue();
    });
    await login(page, 'fr');
    await page.getByRole('link', { name: copy.fr.types, exact: true }).click();
    for (const language of ['fr', 'de', 'it'] as const) {
      await changeLanguage(page, language);
      await expect(page.getByRole('heading', { name: copy[language].types, exact: true })).toBeVisible();
      await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
      await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(2);
      for (const control of [
        page.locator('#language'),
        page.getByRole('button', { name: editName(language, label), exact: true }),
        page.getByRole('button', { name: deleteName(language, label), exact: true })
      ]) {
        const box = await control.boundingBox();
        if (!box) throw new Error('Localized mobile control is not rendered');
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )).toBe(true);
    }
  } finally {
    await context.close();
  }
});
