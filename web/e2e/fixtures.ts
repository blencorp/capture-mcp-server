import type { Page } from '@playwright/test';

export const ORIGIN = 'https://capture.example.test';

/**
 * The hosted server has no accounts, so the pages make no API calls of their own. The kit's header
 * still asks Better Auth for a session; answer it as the server would for a signed-out browser.
 */
export async function mockServer(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
}
