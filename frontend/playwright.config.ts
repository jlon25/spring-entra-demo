import { defineConfig } from '@playwright/test';

// Playwright otherwise writes a DOM error-context.md even when tracing is off.
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['FRONTEND_BASE_URL'] ?? 'http://127.0.0.1:4200',
    // Login bodies and Bearer headers must not be captured in artifacts.
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  }
});
