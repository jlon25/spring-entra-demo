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

test('uses desktop space and contains table scrolling while navigation remains keyboard accessible', async ({ page }) => {
  const label = 'Fictitious-responsive-' + 'LongLabel'.repeat(10);
  await page.route('**/api/hearing-types', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [{
        id: 'responsive-ui-only', label, durationMinutes: 75,
        pauseMinutes: 0, defenderRequired: true, version: 0
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
    await expect(navigation.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible();
    if (width === 1920) {
      expect(main.width).toBeGreaterThanOrEqual(width * 0.8);
      expect(main.width).toBeLessThanOrEqual(1601);
      expect(tableBox.width).toBeGreaterThan(1400);
    }
  }

  await page.setViewportSize({ width: 320, height: 900 });
  const scrollArea = page.locator('.table-scroll');
  expect(await scrollArea.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scrollArea.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expectNoPageOverflow(page);
  await typesLink.focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeFocused();
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
    await page.route('**/api/hearing-types', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{
          id: 'responsive-touch-ui-only', label: 'Fictitious touch type',
          durationMinutes: 60, pauseMinutes: 0, defenderRequired: false, version: 0
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
