import { expect, test, type Page } from '@playwright/test';

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

test('requires login and rejects wrong credentials without calling the API', async ({ page }) => {
  let protectedCalls = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) protectedCalls++;
  });
  await page.goto('/accueil');
  await expect(page.getByRole('heading', { name: 'Connexion locale' })).toBeVisible();
  await page.getByLabel('Nom d’utilisateur').fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill('wrong-disposable-password');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('');
  expect(protectedCalls).toBe(0);
});

test('uses a real signed token, logs out and keeps no session after reload', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Vérifier l’accès à l’API' }).click();
  await expect(page.getByRole('status')).toContainText('authenticated');
  expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion locale' })).toBeVisible();
  await login(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connexion locale' })).toBeVisible();
});

test('clears the session when the API rejects its authorization', async ({ page }) => {
  await login(page);
  // This API failure alone is simulated; login above uses the real issuer.
  await page.route('**/api/message', route => route.fulfill({ status: 401, body: '' }));
  await page.getByRole('button', { name: 'Vérifier l’accès à l’API' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion locale' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('expiré');
});

test('keeps the session and explains a forbidden API operation', async ({ page }) => {
  await login(page);
  // Explicit UI authorization-error test, separate from the real successful API call.
  await page.route('**/api/message', route => route.fulfill({ status: 403, body: '' }));
  await page.getByRole('button', { name: 'Vérifier l’accès à l’API' }).click();
  await expect(page.getByRole('alert')).toContainText('droits sont insuffisants');
  await expect(page.getByRole('heading', { name: 'Accueil', exact: true })).toBeVisible();
});
