import { expect, test, type Page, type Response } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

const copy = {
  fr: {
    nav: 'Personnes', title: 'Personnes auditionnées', create: 'Nouvelle personne',
    reference: 'Référence', minority: 'Statut de minorité', save: 'Enregistrer',
    cancel: 'Annuler', editTitle: 'Modifier une personne',
    reload: 'Recharger la version serveur'
  },
  de: {
    nav: 'Personen', title: 'Anzuhörende Personen', create: 'Neue Person',
    reference: 'Referenz', minority: 'Volljährigkeitsstatus', save: 'Speichern',
    cancel: 'Abbrechen', editTitle: 'Person bearbeiten',
    reload: 'Serverversion neu laden'
  },
  it: {
    nav: 'Persone', title: 'Persone da audire', create: 'Nuova persona',
    reference: 'Riferimento', minority: 'Stato di maggiore età', save: 'Salva',
    cancel: 'Annulla', editTitle: 'Modifica una persona',
    reload: 'Ricarica la versione del server'
  }
} as const;
type Language = keyof typeof copy;

function editName(language: Language, reference: string): string {
  return language === 'de' ? reference + ' bearbeiten'
    : language === 'it' ? 'Modifica ' + reference : 'Modifier ' + reference;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  // Use the real local account. The language change stores no authentication data.
  await page.locator('#language').selectOption('fr');
  await page.getByLabel('Nom d’utilisateur', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
}

async function openPersons(page: Page, language: Language = 'fr'): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: copy[language].nav, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy[language].title, exact: true })).toBeVisible();
}

function writeResponse(page: Page, method: 'POST' | 'PUT'): Promise<Response> {
  return page.waitForResponse(response => response.request().method() === method
    && /^\/api\/heard-persons(?:\/[^/]+)?$/.test(new URL(response.url()).pathname));
}

async function createPerson(page: Page, reference: string, language: Language = 'fr'): Promise<Response> {
  const text = copy[language];
  await page.getByRole('button', { name: text.create, exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(text.reference, { exact: true })).toBeFocused();
  await expect(page.getByLabel(text.minority, { exact: true })).toHaveValue('UNKNOWN');
  await page.getByLabel(text.reference, { exact: true }).fill(reference);
  const pending = writeResponse(page, 'POST');
  await page.getByRole('button', { name: text.save, exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('rowheader', { name: reference, exact: true })).toBeVisible();
  return response;
}

// These journeys use real HTTP, the local signed-token issuer and PostgreSQL.
// References are explicitly fictitious. No names or dates of birth are supplied.
test('creates a minimal person with unknown minority status, edits it and rereads persisted values', async ({ page }) => {
  const reference = 'Fictitious-person-' + Date.now();
  await login(page);
  await openPersons(page);
  const created = await createPerson(page, reference);
  expect(Object.keys(created.request().postDataJSON()).sort()).toEqual(['minorityStatus', 'reference']);
  const resource = await created.json();
  expect(Object.keys(resource).sort()).toEqual(['id', 'minorityStatus', 'reference', 'version']);
  expect(resource.reference).toBe(reference);
  expect(resource.minorityStatus).toBe('UNKNOWN');
  expect(resource.version).toBe(0);

  await page.getByRole('button', { name: editName('fr', reference), exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName(copy.fr.editTitle);
  await page.getByLabel(copy.fr.minority, { exact: true }).selectOption('MINOR');
  const pending = writeResponse(page, 'PUT');
  await page.getByRole('button', { name: copy.fr.save, exact: true }).click();
  const updated = await pending;
  expect(updated.status()).toBe(200);
  expect(Object.keys(updated.request().postDataJSON()).sort()).toEqual(['minorityStatus', 'reference', 'version']);
  expect(updated.request().postDataJSON().version).toBe(0);
  expect((await updated.json()).version).toBe(1);
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: copy.fr.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: editName('fr', reference), exact: true }).click();
  await expect(page.getByLabel(copy.fr.reference, { exact: true })).toHaveValue(reference);
  await expect(page.getByLabel(copy.fr.minority, { exact: true })).toHaveValue('MINOR');
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(1);
});

test('refuses a duplicate reference without losing the new draft or sending unrelated identity fields', async ({ page }) => {
  const reference = 'Fictitious-person-duplicate-' + Date.now();
  await login(page);
  await openPersons(page);
  await createPerson(page, reference);
  await page.getByRole('button', { name: copy.fr.create, exact: true }).click();
  await page.getByLabel(copy.fr.reference, { exact: true }).fill(reference);
  await page.getByLabel(copy.fr.minority, { exact: true }).selectOption('ADULT');
  const pending = writeResponse(page, 'POST');
  await page.getByRole('button', { name: copy.fr.save, exact: true }).click();
  const refused = await pending;
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe('reference_conflict');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel(copy.fr.reference, { exact: true })).toHaveValue(reference);
  await expect(page.getByLabel(copy.fr.minority, { exact: true })).toHaveValue('ADULT');
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  // Correcting a duplicate is different from a stale-version conflict.
  const corrected = reference + '-other';
  await page.getByLabel(copy.fr.reference, { exact: true }).fill(corrected);
  const correctedResponse = writeResponse(page, 'POST');
  await page.getByRole('button', { name: copy.fr.save, exact: true }).click();
  expect((await correctedResponse).status()).toBe(201);
  await expect(page.getByRole('rowheader', { name: corrected, exact: true })).toBeVisible();
});

test('preserves a stale person draft until the current server version is explicitly reloaded', async ({ page }) => {
  const reference = 'Fictitious-person-concurrent-' + Date.now();
  await login(page);
  await openPersons(page);
  await createPerson(page, reference);
  await page.getByRole('button', { name: editName('fr', reference), exact: true }).click();
  const second = await page.context().newPage();
  try {
    await login(second);
    await openPersons(second);
    await second.getByRole('button', { name: editName('fr', reference), exact: true }).click();
    await expect(second.getByLabel(copy.fr.minority, { exact: true })).toHaveValue('UNKNOWN');
    await page.getByLabel(copy.fr.minority, { exact: true }).selectOption('MINOR');
    const firstWrite = writeResponse(page, 'PUT');
    await page.getByRole('button', { name: copy.fr.save, exact: true }).click();
    expect((await firstWrite).status()).toBe(200);

    await second.getByLabel(copy.fr.minority, { exact: true }).selectOption('ADULT');
    const staleWrite = writeResponse(second, 'PUT');
    await second.getByRole('button', { name: copy.fr.save, exact: true }).click();
    const refused = await staleWrite;
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe('concurrent_modification');
    await expect(second.getByRole('dialog')).toBeVisible();
    await expect(second.getByLabel(copy.fr.minority, { exact: true })).toHaveValue('ADULT');
    await expect(second.getByRole('button', { name: copy.fr.save, exact: true })).toBeDisabled();
    await second.getByRole('button', { name: copy.fr.reload, exact: true }).click();
    await expect(second.getByLabel(copy.fr.minority, { exact: true })).toHaveValue('MINOR');
    await second.getByLabel(copy.fr.minority, { exact: true }).selectOption('ADULT');
    const refreshedWrite = writeResponse(second, 'PUT');
    await second.getByRole('button', { name: copy.fr.save, exact: true }).click();
    const saved = await refreshedWrite;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON().version).toBe(1);
    expect((await saved.json()).version).toBe(2);
  } finally {
    await second.close();
  }
});

for (const language of ['de', 'it'] as const) {
  test('keeps the minimal person form usable on mobile in ' + language, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env['FRONTEND_BASE_URL'] ?? 'http://127.0.0.1:4200',
      viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true
    });
    const page = await context.newPage();
    try {
      const text = copy[language];
      const reference = 'Fictitious-person-' + language + '-' + Date.now();
      await login(page);
      await page.locator('#language').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await openPersons(page, language);
      await createPerson(page, reference, language);
      const edit = page.getByRole('button', { name: editName(language, reference), exact: true });
      const box = await edit.boundingBox();
      if (!box) throw new Error('Person edit action is not rendered');
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )).toBe(true);
      await edit.click();
      await expect(page.getByRole('dialog')).toHaveAccessibleName(text.editTitle);
      await expect(page.getByLabel(text.reference, { exact: true })).toHaveValue(reference);
      await page.getByLabel(text.minority, { exact: true }).selectOption('ADULT');
      const pending = writeResponse(page, 'PUT');
      await page.getByRole('button', { name: text.save, exact: true }).click();
      expect((await pending).status()).toBe(200);
      await expect(page.getByRole('dialog')).toBeHidden();
      await edit.click();
      await expect(page.getByLabel(text.minority, { exact: true })).toHaveValue('ADULT');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(edit).toBeFocused();
    } finally {
      await context.close();
    }
  });
}
