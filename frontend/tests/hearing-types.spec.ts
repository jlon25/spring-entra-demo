import { expect, test, type Page, type Response } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Nom d’utilisateur').fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
}

async function openTypes(page: Page): Promise<void> {
  // SPA navigation preserves the deliberately memory-only session.
  await page.getByRole('link', { name: 'Types d’audition', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
}

async function fillType(page: Page, label: string, duration: string, pause: string): Promise<void> {
  await page.getByLabel('Libellé', { exact: true }).fill(label);
  await page.getByLabel('Durée (minutes)', { exact: true }).fill(duration);
  await page.getByLabel('Pause minimale (minutes)', { exact: true }).fill(pause);
  await page.getByLabel('Défenseur requis', { exact: true }).check();
}

function writeResponse(page: Page, method: 'POST' | 'PUT' | 'DELETE'): Promise<Response> {
  return page.waitForResponse(response => response.request().method() === method
    && /^\/api\/hearing-types(?:\/[^/]+)?$/.test(new URL(response.url()).pathname));
}

async function createType(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Nouveau type', exact: true }).click();
  await fillType(page, label, '60', '0');
  const created = writeResponse(page, 'POST');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Modifier ' + label, exact: true })).toBeVisible();
}

test('creates and updates a type with zero pause and rereads persisted values after reload', async ({ page }) => {
  const label = 'Fictitious-browser-crud-' + Date.now();
  await login(page);
  await openTypes(page);
  await createType(page, label);
  await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
  await expect(page.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveValue('0');
  await page.getByLabel('Durée (minutes)', { exact: true }).fill('75');
  const updated = writeResponse(page, 'PUT');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connexion locale', exact: true })).toBeVisible();
  await login(page);
  await openTypes(page);
  await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
  await expect(page.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('75');
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Défenseur requis', { exact: true })).toBeChecked();
});

test('rejects invalid numbers locally before any write and accepts zero pause', async ({ page }) => {
  let writes = 0;
  page.on('request', request => {
    if (['POST', 'PUT'].includes(request.method())
        && new URL(request.url()).pathname.startsWith('/api/hearing-types')) writes++;
  });
  await login(page);
  await openTypes(page);
  await page.getByRole('button', { name: 'Nouveau type', exact: true }).click();
  const label = 'Fictitious-browser-validation-' + Date.now();
  await fillType(page, label, '0', '0');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByLabel('Durée (minutes)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await fillType(page, label, '60', '-1');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await fillType(page, label, '60', '1.5');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(writes).toBe(0);
  await fillType(page, label, '60', '0');
  const created = writeResponse(page, 'POST');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await created).status()).toBe(201);
  expect(writes).toBe(1);
});

test('preserves a stale draft, reloads the current version and then saves without overwriting silently', async ({ page }) => {
  const label = 'Fictitious-browser-concurrent-' + Date.now();
  await login(page);
  await openTypes(page);
  await createType(page, label);
  await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
  await expect(page.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('60');
  const second = await page.context().newPage();
  try {
    await login(second);
    await openTypes(second);
    await second.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
    await expect(second.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('60');
    await page.getByLabel('Durée (minutes)', { exact: true }).fill('90');
    const firstSave = writeResponse(page, 'PUT');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await firstSave).status()).toBe(200);
    await second.getByLabel('Durée (minutes)', { exact: true }).fill('120');
    const staleSave = writeResponse(second, 'PUT');
    await second.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await staleSave).status()).toBe(409);
    await expect(second.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('120');
    await second.getByRole('button', { name: 'Recharger la version serveur', exact: true }).click();
    await expect(second.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('90');
    await second.getByLabel('Durée (minutes)', { exact: true }).fill('120');
    const refreshedSave = writeResponse(second, 'PUT');
    await second.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await refreshedSave).status()).toBe(200);
    await second.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
    await expect(second.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('120');
  } finally {
    await second.close();
  }
});

test('requires confirmation, supports cancellation and deletes the type persistently', async ({ page }) => {
  const label = 'Fictitious-browser-delete-' + Date.now();
  let deletions = 0;
  page.on('request', request => {
    if (request.method() === 'DELETE'
        && new URL(request.url()).pathname.startsWith('/api/hearing-types/')) deletions++;
  });
  await login(page);
  await openTypes(page);
  await createType(page, label);
  await page.getByRole('button', { name: 'Supprimer ' + label, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la suppression', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeHidden();
  expect(deletions).toBe(0);
  await page.getByRole('button', { name: 'Supprimer ' + label, exact: true }).click();
  const deleted = writeResponse(page, 'DELETE');
  await page.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
  const response = await deleted;
  expect(response.status()).toBe(204);
  expect(new URL(response.request().url()).searchParams.get('version')).toBe('0');
  await expect(page.getByRole('button', { name: 'Supprimer ' + label, exact: true })).toBeHidden();
  expect(deletions).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connexion locale', exact: true })).toBeVisible();
  await login(page);
  const listed = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/hearing-types');
  await openTypes(page);
  expect((await listed).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Supprimer ' + label, exact: true })).toBeHidden();
});

test('refuses deletion of an obsolete version and requires a new confirmation after reloading', async ({ page }) => {
  const label = 'Fictitious-browser-delete-stale-' + Date.now();
  await login(page);
  await openTypes(page);
  await createType(page, label);
  const second = await page.context().newPage();
  try {
    await login(second);
    await openTypes(second);
    await expect(second.getByRole('button', { name: 'Supprimer ' + label, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
    await page.getByLabel('Durée (minutes)', { exact: true }).fill('75');
    const updated = writeResponse(page, 'PUT');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await updated).status()).toBe(200);
    await second.getByRole('button', { name: 'Supprimer ' + label, exact: true }).click();
    const stale = writeResponse(second, 'DELETE');
    await second.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
    const refused = await stale;
    expect(refused.status()).toBe(409);
    expect(new URL(refused.request().url()).searchParams.get('version')).toBe('0');
    await expect(second.getByRole('button', { name: 'Recharger les types', exact: true })).toBeVisible();
    const listed = second.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/hearing-types');
    await second.getByRole('button', { name: 'Recharger les types', exact: true }).click();
    expect((await listed).status()).toBe(200);
    await expect(second.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeHidden();
    await second.getByRole('button', { name: 'Supprimer ' + label, exact: true }).click();
    const deletion = writeResponse(second, 'DELETE');
    await second.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
    const deleted = await deletion;
    expect(deleted.status()).toBe(204);
    expect(new URL(deleted.request().url()).searchParams.get('version')).toBe('1');
    await expect(second.getByRole('button', { name: 'Supprimer ' + label, exact: true })).toBeHidden();
  } finally {
    await second.close();
  }
});
