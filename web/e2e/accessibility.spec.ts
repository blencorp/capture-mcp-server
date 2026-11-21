import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockServer } from './fixtures';

// WCAG 2.0, 2.1 and 2.2 A/AA: Section 508 incorporates WCAG 2.0 AA; 2.1 and 2.2 AA are the
// project's target. Automated rules cover part of the criteria; docs/accessibility.md lists the
// manual checks.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Every page a person can reach. */
const PAGES: { name: string; path: string; heading: RegExp }[] = [
  { name: 'home', path: '/', heading: /procurement data/i },
  { name: 'privacy policy', path: '/privacy-policy', heading: /privacy policy/i },
  { name: 'terms', path: '/terms', heading: /terms of service/i },
  { name: 'not found', path: '/no-such-page', heading: /page not found/i },
];

async function open(page: Page, path: string, heading: RegExp) {
  await mockServer(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
    test.describe(`${scheme}, ${viewport.width}px`, () => {
      test.use({ colorScheme: scheme, viewport });
      for (const { name, path, heading } of PAGES) {
        test(`${name} has no axe violations and reflows without horizontal scrolling`, async ({ page }) => {
          await open(page, path, heading);
          await expectNoViolations(page);
          // 1.4.10 Reflow: at 320 CSS px nothing needs horizontal scrolling.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
        });
      }
    });
  }
}

test.describe('structure', () => {
  for (const { name, path, heading } of PAGES) {
    test(`${name}: one h1, landmarks, a page title and a skip link`, async ({ page }) => {
      await open(page, path, heading);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page).toHaveTitle(/Capture MCP/);
      // 2.4.1 Bypass blocks: the first Tab reaches the skip link, which moves to main.
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skip).toBeFocused();
      await skip.press('Enter');
      await expect(page.locator('#main')).toBeFocused();
    });
  }

  test('1.4.12 text spacing: increased spacing does not clip or overflow content', async ({ page }) => {
    for (const { path, heading } of PAGES) {
      await open(page, path, heading);
      await page.addStyleTag({
        content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('behaviour', () => {
  test('copying the server URL is announced', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '/', /procurement data/i);
    await page.getByRole('button', { name: 'Copy the server URL' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'the server URL copied' })).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/mcp');
  });
});
