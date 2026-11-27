import { expect, test, type Page, type Response } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Nom d’utilisateur', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Types d’audition', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
}

function writeResponse(page: Page, method: 'POST' | 'PUT' | 'DELETE', statusOnly = false): Promise<Response> {
  return page.waitForResponse(response => {
    const path = new URL(response.url()).pathname;
    return response.request().method() === method
      && (statusOnly ? /^\/api\/hearing-types\/[^/]+\/status$/.test(path)
        : /^\/api\/hearing-types(?:\/[^/]+)?$/.test(path));
  });
}

function listed(page: Page, active: boolean): Promise<Response> {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/hearing-types'
      && (url.searchParams.get('active') !== 'false') === active;
  });
}

async function selectState(page: Page, active: boolean): Promise<void> {
  const response = listed(page, active);
  await page.locator('#type-status-filter').selectOption(active ? 'active' : 'inactive');
  expect((await response).status()).toBe(200);
}

async function create(page: Page, label: string): Promise<{ id: string; active: boolean; version: number }> {
  await page.getByRole('button', { name: 'Nouveau type', exact: true }).click();
  await page.getByLabel('Libellé', { exact: true }).fill(label);
  await page.getByLabel('Durée (minutes)', { exact: true }).fill('60');
  await page.getByLabel('Pause minimale (minutes)', { exact: true }).fill('0');
  await page.getByLabel('Défenseur requis', { exact: true }).check();
  const response = writeResponse(page, 'POST');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const body = await created.json();
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  return body;
}

// Real API, signed local login and PostgreSQL: switching views does not erase
// a type, and editing an inactive type must never silently reactivate it.
test('filters active types by default and reactivates a preserved type from the inactive view', async ({ page }) => {
  const label = 'Fictitious-status-cycle-' + Date.now();
  await login(page);
  await expect(page.locator('#type-status-filter')).toHaveValue('active');
  const created = await create(page, label);
  expect(created.active).toBe(true);
  expect(created.version).toBe(0);

  let statusWrites = 0;
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/status')) statusWrites++;
  });
  await page.getByRole('button', { name: 'Désactiver ' + label, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Annuler le changement d’état', exact: true }).click();
  expect(statusWrites).toBe(0);
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Désactiver ' + label, exact: true }).click();
  const deactivation = writeResponse(page, 'PUT', true);
  await page.getByRole('button', { name: 'Confirmer la désactivation', exact: true }).click();
  const inactive = await deactivation;
  expect(inactive.status()).toBe(200);
  expect(inactive.request().postDataJSON()).toEqual({ active: false, version: 0 });
  expect((await inactive.json()).active).toBe(false);
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeHidden();
  await expect(page.locator('#type-status-filter')).toHaveValue('active');

  await selectState(page, false);
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveValue('0');
  await page.getByLabel('Durée (minutes)', { exact: true }).fill('75');
  const edited = writeResponse(page, 'PUT');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const updated = await edited;
  expect(updated.status()).toBe(200);
  expect((await updated.json()).active).toBe(false);
  await expect(page.locator('#type-status-filter')).toHaveValue('inactive');
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Activer ' + label, exact: true }).click();
  const reactivation = writeResponse(page, 'PUT', true);
  await page.getByRole('button', { name: 'Confirmer l’activation', exact: true }).click();
  const active = await reactivation;
  expect(active.status()).toBe(200);
  expect(active.request().postDataJSON()).toEqual({ active: true, version: 2 });
  expect((await active.json()).active).toBe(true);
  await expect(page.locator('#type-status-filter')).toHaveValue('inactive');
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeHidden();

  await selectState(page, true);
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#type-status-filter')).toHaveValue('active');
  await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
  await expect(page.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('75');
  await expect(page.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveValue('0');
  await page.keyboard.press('Escape');
  expect(statusWrites).toBe(2);
});

test('refuses a stale status change after another editor writes and requires a fresh confirmation', async ({ page }) => {
  const label = 'Fictitious-status-conflict-' + Date.now();
  await login(page);
  await create(page, label);
  const second = await page.context().newPage();
  try {
    await login(second);
    await expect(second.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Désactiver ' + label, exact: true }).click();
    await page.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
    await page.getByLabel('Durée (minutes)', { exact: true }).fill('90');
    const update = writeResponse(page, 'PUT');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await update).status()).toBe(200);

    let statusWrites = 0;
    second.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/status')) statusWrites++;
    });
    const stale = writeResponse(second, 'PUT', true);
    await second.getByRole('button', { name: 'Confirmer la désactivation', exact: true }).click();
    const refused = await stale;
    expect(refused.status()).toBe(409);
    expect(refused.request().postDataJSON()).toEqual({ active: false, version: 0 });
    await expect(second.getByRole('dialog')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Confirmer la désactivation', exact: true })).toBeDisabled();
    expect(statusWrites).toBe(1);

    const current = listed(second, true);
    await second.getByRole('button', { name: 'Recharger les types', exact: true }).click();
    expect((await current).status()).toBe(200);
    await expect(second.getByRole('dialog')).toBeHidden();
    await second.getByRole('button', { name: 'Désactiver ' + label, exact: true }).click();
    const retry = writeResponse(second, 'PUT', true);
    await second.getByRole('button', { name: 'Confirmer la désactivation', exact: true }).click();
    const accepted = await retry;
    expect(accepted.status()).toBe(200);
    expect(accepted.request().postDataJSON()).toEqual({ active: false, version: 1 });
    expect(statusWrites).toBe(2);
    await expect(second.getByRole('rowheader', { name: label, exact: true })).toBeHidden();
    await selectState(second, false);
    await second.getByRole('button', { name: 'Modifier ' + label, exact: true }).click();
    await expect(second.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('90');
  } finally {
    await second.close();
  }
});

const copy = {
  fr: { types: 'Types d’audition', filter: 'État des types', active: 'Actifs', inactive: 'Inactifs',
    edit: (label: string) => 'Modifier ' + label, remove: (label: string) => 'Supprimer ' + label,
    disable: (label: string) => 'Désactiver ' + label, enable: (label: string) => 'Activer ' + label },
  de: { types: 'Anhörungstypen', filter: 'Typstatus', active: 'Aktive', inactive: 'Inaktive',
    edit: (label: string) => label + ' bearbeiten', remove: (label: string) => label + ' löschen',
    disable: (label: string) => label + ' deaktivieren', enable: (label: string) => label + ' aktivieren' },
  it: { types: 'Tipi di audizione', filter: 'Stato dei tipi', active: 'Attivi', inactive: 'Inattivi',
    edit: (label: string) => 'Modifica ' + label, remove: (label: string) => 'Elimina ' + label,
    disable: (label: string) => 'Disattiva ' + label, enable: (label: string) => 'Attiva ' + label }
} as const;

test('keeps the two filters and three mobile icon actions accessible in all languages', async ({ page }) => {
  const label = 'Fictitious mobile status ' + 'Long'.repeat(20);
  // Only list data is simulated here; no persisted state or JWT validation is
  // claimed by this presentation test. Login uses the real local issuer.
  await page.route(url => url.pathname === '/api/hearing-types', async route => {
    if (route.request().method() === 'GET') {
      const active = new URL(route.request().url()).searchParams.get('active') !== 'false';
      await route.fulfill({ json: [{
        id: 'mobile-status-ui-only', label, durationMinutes: 60, pauseMinutes: 0,
        defenderRequired: true, active, version: 0
      }] });
    } else await route.continue();
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await login(page);
  for (const language of ['fr', 'de', 'it'] as const) {
    await page.locator('#language').selectOption(language);
    const text = copy[language];
    await expect(page.getByRole('heading', { name: text.types, exact: true })).toBeVisible();
    const filter = page.getByLabel(text.filter, { exact: true });
    await expect(filter).toHaveValue('active');
    await expect(filter.getByRole('option')).toHaveText([text.active, text.inactive]);
    await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(2);
    const actions = [
      page.getByRole('button', { name: text.edit(label), exact: true }),
      page.getByRole('button', { name: text.remove(label), exact: true }),
      page.getByRole('button', { name: text.disable(label), exact: true })
    ];
    const boxes = [];
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      if (!box) throw new Error('Mobile status action is not rendered');
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect(action.locator('svg')).toBeVisible();
      await expect(action.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const b = boxes[j];
        const gap = Math.max(b.x - a.x - a.width, a.x - b.x - b.width,
          b.y - a.y - a.height, a.y - b.y - b.height);
        expect(gap).toBeGreaterThanOrEqual(7);
      }
    }
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )).toBe(true);
    await selectState(page, false);
    await expect(page.getByRole('button', { name: text.enable(label), exact: true })).toBeVisible();
    await selectState(page, true);
  }
});
