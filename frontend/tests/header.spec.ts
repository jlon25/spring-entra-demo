import { expect, test, type Locator, type Page } from '@playwright/test';

const username = process.env['DEV_IDENTITY_USERNAME'] ?? 'local-user';
const password = process.env['DEV_IDENTITY_PASSWORD'];
if (!password) throw new Error('Configure disposable development credentials for browser tests.');

const copy = {
  fr: { login: 'Connexion locale', home: 'Accueil', logout: 'Se déconnecter' },
  de: { login: 'Lokale Anmeldung', home: 'Startseite', logout: 'Abmelden' },
  it: { login: 'Accesso locale', home: 'Pagina iniziale', logout: 'Disconnettersi' }
} as const;
type Language = keyof typeof copy;

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const value = await locator.boundingBox();
  if (!value) throw new Error('Header element is not rendered');
  return value;
}

async function selectLanguage(page: Page, language: Language): Promise<void> {
  await page.locator('#language').selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await selectLanguage(page, 'fr');
  await page.getByLabel('Nom d’utilisateur', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
}

async function expectDesktopZones(page: Page, authenticated: boolean, language: Language): Promise<void> {
  const header = page.locator('.header-inner');
  const nav = header.getByRole('navigation');
  const actions = header.locator('.header-actions');
  const outer = await bounds(header);
  const brand = await bounds(header.locator('.brand'));
  const middle = await bounds(nav);
  const right = await bounds(actions);
  expect(Math.abs(middle.x + middle.width / 2 - outer.x - outer.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(brand.x - outer.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(right.x + right.width - outer.x - outer.width)).toBeLessThanOrEqual(1);
  expect(brand.x + brand.width).toBeLessThanOrEqual(middle.x);
  expect(middle.x + middle.width).toBeLessThanOrEqual(right.x);
  await expect(actions.locator('#language')).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(0);
  if (authenticated) {
    const logout = actions.getByRole('button', { name: copy[language].logout, exact: true });
    const button = await bounds(logout);
    const picker = await bounds(actions.locator('.language-picker'));
    expect(picker.x + picker.width).toBeLessThanOrEqual(button.x);
  } else {
    await expect(actions.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: copy[language].login, exact: true })).toBeVisible();
  }
}

// Real local login; these tests inspect header geometry and keyboard behavior.
// They do not simulate credentials, API responses or database data.
test('centers desktop navigation between the brand and grouped account controls in every language', async ({ page }) => {
  await page.goto('/login');
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ['fr', 'de', 'it'] as const) {
      await selectLanguage(page, language);
      await expectDesktopZones(page, false, language);
    }
  }
  await login(page);
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ['fr', 'de', 'it'] as const) {
      await selectLanguage(page, language);
      await expectDesktopZones(page, true, language);
      const nav = page.locator('.header-inner').getByRole('navigation');
      await nav.getByRole('link').last().focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('#language')).toBeFocused();
      await expect(page.locator('#language')).toHaveAccessibleName(
        { fr: 'Langue', de: 'Sprache', it: 'Lingua' }[language]
      );
      await expect(page.locator('label[for="language"]')).toHaveCount(0);
      await page.keyboard.press('Tab');
      await expect(page.locator('.header-actions').getByRole('button', {
        name: copy[language].logout, exact: true
      })).toBeFocused();
    }
  }
});

test('keeps navigation and grouped account controls reachable without overlap on smaller touch screens', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env['FRONTEND_BASE_URL'] ?? 'http://127.0.0.1:4200',
    viewport: { width: 320, height: 900 }, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();
  try {
    await login(page);
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of ['fr', 'de', 'it'] as const) {
        await selectLanguage(page, language);
        await expect(page.getByRole('heading', { name: copy[language].home, exact: true })).toBeVisible();
        const header = page.locator('.header-inner');
        const controls = [
          ...await header.getByRole('navigation').getByRole('link').all(),
          header.locator('.header-actions').getByRole('button', { name: copy[language].logout, exact: true }),
          header.locator('#language')
        ];
        const boxes = [];
        for (const control of controls) {
          const box = await bounds(control);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          await expect(control).toBeInViewport();
          boxes.push(box);
        }
        for (let first = 0; first < boxes.length; first++) {
          for (let second = first + 1; second < boxes.length; second++) {
            const a = boxes[first];
            const b = boxes[second];
            const gap = Math.max(b.x - a.x - a.width, a.x - b.x - b.width,
              b.y - a.y - a.height, a.y - b.y - b.height);
            expect(gap).toBeGreaterThanOrEqual(-1);
          }
        }
        expect(await page.evaluate(() =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )).toBe(true);
      }
    }
    // Account action still works after repeated resizing and language changes.
    await page.locator('.header-actions').getByRole('button', {
      name: copy.it.logout, exact: true
    }).click();
    await expect(page.getByRole('heading', { name: copy.it.login, exact: true })).toBeVisible();
    await expect(page.locator('#language')).toHaveValue('it');
  } finally {
    await context.close();
  }
});
