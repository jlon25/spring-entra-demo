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
  // Router navigation keeps the current tab session and page state.
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
  await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
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
    await expect(second.getByRole('dialog')).toBeVisible();
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
  const listed = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/hearing-types');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
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
    await expect(second.getByRole('dialog')).toBeVisible();
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

test('keeps compact row actions separated on desktop, tablet and mobile', async ({ page }) => {
  const label = 'Fictitious-layout-' + Date.now() + '-Audition complémentaire';
  await login(page);
  await openTypes(page);
  await createType(page, label);
  const edit = page.getByRole('button', { name: 'Modifier ' + label, exact: true });
  const remove = page.getByRole('button', { name: 'Supprimer ' + label, exact: true });
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await remove.scrollIntoViewIfNeeded();
    const a = await edit.boundingBox();
    const b = await remove.boundingBox();
    if (!a || !b) throw new Error('Row action is not rendered');
    const minimumHeight = width < 640 ? 44 : 32;
    const maximumHeight = width < 640 ? 45 : 36;
    expect(a.height).toBeGreaterThanOrEqual(minimumHeight);
    expect(a.height).toBeLessThanOrEqual(maximumHeight);
    expect(b.height).toBeGreaterThanOrEqual(minimumHeight);
    expect(b.height).toBeLessThanOrEqual(maximumHeight);
    const gap = Math.max(b.x - a.x - a.width, a.x - b.x - b.width,
      b.y - a.y - a.height, a.y - b.y - b.height);
    expect(gap).toBeGreaterThanOrEqual(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await remove.click();
  await expect(page.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la suppression', exact: true }).click();
  await expect(remove).toBeEnabled();
});


// These two UI/accessibility tests simulate only the list response to exercise a
// long page without persisting hundreds of rows. The CRUD/conflict tests above
// still use the real API, signed JWTs and PostgreSQL.
test('opens modals above a long list and restores focus after keyboard cancellation', async ({ page }) => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: 'ui-modal-' + index,
    label: 'Fictitious modal row ' + index,
    durationMinutes: 60, pauseMinutes: 0, defenderRequired: true, version: 0
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/hearing-types', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: rows });
    else await route.continue();
  });
  let writes = 0;
  page.on('request', request => {
    if (['POST', 'PUT', 'DELETE'].includes(request.method())
        && new URL(request.url()).pathname.startsWith('/api/hearing-types')) writes++;
  });
  await login(page);
  await openTypes(page);
  const edit = page.getByRole('button', { name: 'Modifier ' + rows[199].label, exact: true });
  const remove = page.getByRole('button', { name: 'Supprimer ' + rows[199].label, exact: true });
  await edit.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await edit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Modifier un type');
  await expect(dialog.getByLabel('Libellé', { exact: true })).toBeFocused();
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error('Edit dialog is not rendered');
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(721);
  // Native modality must keep both forward and backward keyboard navigation
  // inside the dialog instead of reaching the list or the main navigation.
  for (const key of ['Shift+Tab', ...Array<string>(10).fill('Tab')]) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annuler la suppression', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  expect(writes).toBe(0);

  const create = page.getByRole('button', { name: 'Nouveau type', exact: true });
  await create.click();
  await expect(dialog).toHaveAccessibleName('Créer un type');
  await expect(dialog.getByLabel('Libellé', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(create).toBeFocused();
  expect(writes).toBe(0);
});

test('keeps modal controls reachable in a short mobile viewport without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await page.route('**/api/hearing-types', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [{
        id: 'ui-modal-mobile', label: 'Fictitious mobile modal type',
        durationMinutes: 60, pauseMinutes: 0, defenderRequired: false, version: 0
      }] });
    } else await route.continue();
  });
  await login(page);
  await openTypes(page);
  await page.getByRole('button', { name: 'Nouveau type', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error('Mobile dialog is not rendered');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(361);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // The small height requires scrolling within the modal to reach its actions.
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const cancel = dialog.getByRole('button', { name: 'Annuler', exact: true });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  await cancel.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Nouveau type', exact: true })).toBeFocused();

  const remove = page.getByRole('button', { name: 'Supprimer Fictitious mobile modal type', exact: true });
  await remove.click();
  await expect(dialog).toBeVisible();
  const cancelDelete = dialog.getByRole('button', { name: 'Annuler la suppression', exact: true });
  await expect(cancelDelete).toBeFocused();
  await cancelDelete.click();
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
});
