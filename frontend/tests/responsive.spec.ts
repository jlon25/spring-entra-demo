import { expect, test, type Page } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

const widths = [320, 390, 768, 1024, 1440, 1920];

async function expectNoPageOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )).toBe(true);
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Nom d’utilisateur').fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
}

// These layout tests use a real login but simulate only the hearing-type list.
// They do not demonstrate PostgreSQL persistence or JWT validation: those are
// covered by the separate integration journeys. 320 CSS px models reflow at a
// narrow effective viewport; it does not claim to automate browser zoom.
test('keeps the login readable without horizontal page scrolling from mobile to desktop', async ({ page }) => {
  await page.goto('/login');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Connexion locale' })).toBeVisible();
    const form = page.locator('main form');
    const box = await form.boundingBox();
    if (!box) throw new Error('Login form is not rendered');
    expect(box.width).toBeLessThanOrEqual(449);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    for (const name of ['Nom d’utilisateur', 'Mot de passe']) {
      const input = page.getByLabel(name, { exact: true });
      await expect(input).toBeVisible();
      const inputBox = await input.boundingBox();
      if (!inputBox) throw new Error('Login input is not rendered');
      expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(width + 1);
    }
    await expectNoPageOverflow(page);
  }
});

test('uses desktop space and keeps the compact mobile table within the page', async ({ page }) => {
  const label = 'Fictitious-responsive-' + 'LongLabel'.repeat(10);
  await page.route(url => url.pathname === '/api/hearing-types', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [{
        id: 'responsive-ui-only', label, durationMinutes: 75,
        pauseMinutes: 0, defenderRequired: true, version: 0, active: true
      }] });
    } else await route.continue();
  });
  await login(page);
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' });
  const typesLink = navigation.getByRole('link', { name: 'Types d’audition', exact: true });
  await typesLink.focus();
  await expect(typesLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoPageOverflow(page);
    const main = await page.getByRole('main').boundingBox();
    const footer = await page.getByRole('contentinfo').boundingBox();
    const table = page.locator('.table-scroll');
    const tableBox = await table.boundingBox();
    if (!main || !footer || !tableBox) throw new Error('Responsive page region is not rendered');
    expect(Math.abs(main.x - footer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(main.width - footer.width)).toBeLessThanOrEqual(1);
    expect(tableBox.x).toBeGreaterThanOrEqual(0);
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(width + 1);
    await expect(typesLink).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible();
    if (width === 1920) {
      expect(main.width).toBeGreaterThanOrEqual(width * 0.8);
      expect(main.width).toBeLessThanOrEqual(1601);
      expect(tableBox.width).toBeGreaterThan(1400);
    }
  }

  await page.setViewportSize({ width: 320, height: 900 });
  const scrollArea = page.locator('.table-scroll');
  expect(await scrollArea.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();
  await expectNoPageOverflow(page);
  await typesLink.focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'Personnes', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#language')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('header').getByRole('button', { name: 'Se déconnecter', exact: true })).toBeFocused();
});

test('provides comfortable touch targets without hiding navigation or row actions', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env['FRONTEND_BASE_URL'] ?? 'http://127.0.0.1:4200',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  try {
    await page.route(url => url.pathname === '/api/hearing-types', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{
          id: 'responsive-touch-ui-only', label: 'Fictitious touch type',
          durationMinutes: 60, pauseMinutes: 0, defenderRequired: false, version: 0, active: true
        }] });
      } else await route.continue();
    });
    await login(page);
    await page.getByRole('link', { name: 'Types d’audition', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Types d’audition', exact: true })).toBeVisible();
    for (const control of [
      page.getByRole('link', { name: 'Accueil', exact: true }),
      page.getByRole('link', { name: 'Types d’audition', exact: true }),
      page.getByRole('button', { name: 'Se déconnecter', exact: true }),
      page.getByRole('button', { name: 'Nouveau type', exact: true }),
      page.getByRole('button', { name: 'Modifier Fictitious touch type', exact: true }),
      page.getByRole('button', { name: 'Supprimer Fictitious touch type', exact: true })
    ]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      if (!box) throw new Error('Touch target is not rendered');
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoPageOverflow(page);
  } finally {
    await context.close();
  }
});


test('shows only labels and named icon actions on mobile while retaining full desktop columns', async ({ page }) => {
  const label = 'Fictitious mobile label ' + 'LongWord'.repeat(8);
  await page.route(url => url.pathname === '/api/hearing-types', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [{
        id: 'mobile-columns-ui-only', label, durationMinutes: 75,
        pauseMinutes: 15, defenderRequired: true, version: 2, active: true
      }] });
    } else await route.continue();
  });
  let writes = 0;
  page.on('request', request => {
    if (['POST', 'PUT', 'DELETE'].includes(request.method())
        && new URL(request.url()).pathname.startsWith('/api/hearing-types')) writes++;
  });
  await login(page);
  await page.getByRole('link', { name: 'Types d’audition', exact: true }).click();
  const table = page.getByRole('table');
  const edit = page.getByRole('button', { name: 'Modifier ' + label, exact: true });
  const remove = page.getByRole('button', { name: 'Supprimer ' + label, exact: true });
  for (const width of [320, 390, 640, 641, 768, 1920, 390]) {
    const mobile = width <= 640;
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveCount(mobile ? 2 : 5);
    for (const name of ['Durée (minutes)', 'Pause (minutes)', 'Défenseur']) {
      const column = table.getByRole('columnheader', { name, exact: true, includeHidden: true });
      if (mobile) await expect(column).toBeHidden();
      else await expect(column).toBeVisible();
    }
    for (const [action, text] of [[edit, 'Modifier'], [remove, 'Supprimer']] as const) {
      await expect(action).toBeVisible();
      await expect(action).toHaveAccessibleName(text + ' ' + label);
      const caption = action.getByText(text, { exact: true });
      const icon = action.locator('svg');
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect(icon).toHaveAttribute('focusable', 'false');
      if (mobile) {
        await expect(caption).toBeHidden();
        await expect(icon).toBeVisible();
        const box = await action.boundingBox();
        if (!box) throw new Error('Mobile icon action is not rendered');
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      } else {
        await expect(caption).toBeVisible();
        await expect(icon).toBeVisible();
      }
    }
    await expectNoPageOverflow(page);
    expect(await page.locator('.table-scroll').evaluate(element =>
      element.scrollWidth <= element.clientWidth + 1
    )).toBe(true);
  }
  // The icon-only controls still support keyboard operation and reveal the
  // hidden list details in the existing editor without changing those values.
  await edit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Modifier un type');
  await expect(dialog.getByLabel('Libellé', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Durée (minutes)', { exact: true })).toHaveValue('75');
  await expect(dialog.getByLabel('Pause minimale (minutes)', { exact: true })).toHaveValue('15');
  await expect(dialog.getByLabel('Défenseur requis', { exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annuler la suppression', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  expect(writes).toBe(0);
});
