import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockServer } from './fixtures';

// The policy URLs are registered as the connectors' privacy policy, so reviewers, crawlers and
// link checkers must read them without running the script (web/prerender.ts prerenders them).
const PAGES = [
  { path: '/privacy-policy', title: 'Privacy policy', source: 'privacy-policy.md' },
  { path: '/terms', title: 'Terms of service', source: 'terms.md' },
];
const headingsOf = (source: string) =>
  [...readFileSync(new URL(`../../legal/${source}`, import.meta.url), 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1]!);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const { path, title, source } of PAGES) {
    test(`${path} shows the policy text and landmarks`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(new RegExp(`^${title} · `));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole('main')).toContainText(headingsOf(source)[0]!);
      for (const heading of headingsOf(source)) await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
    });
  }
});

test.describe('with JavaScript', () => {
  for (const { path, title } of PAGES) {
    test(`${path} hydrates the prerendered page without errors, and the skip link works`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => m.type() === 'error' || m.type() === 'warning' ? problems.push(m.text()) : undefined);
      page.on('pageerror', (e) => problems.push(e.message));
      await mockServer(page);
      await page.goto(path);
      // The header's session check finishes only when the client has taken over.
      await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skip).toBeFocused();
      await skip.press('Enter');
      await expect(page.locator('#main')).toBeFocused();
      expect(problems).toEqual([]);
    });
  }
});
