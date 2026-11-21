import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { pages } from '../../site/src/lib/pages.mjs';

// The documentation site served at /docs (site/, Astro Starlight), against the same WCAG tags as
// the portal. Starlight follows the system color scheme until a reader picks a theme.
const DOCS = 'http://127.0.0.1:4174/docs';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const paths = [...pages.map(({ slug }) => (slug === 'index' ? '/' : `/${slug}/`)), '/no-such-page/'];

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
    test.describe(`docs, ${scheme}, ${viewport.width}px`, () => {
      test.use({ colorScheme: scheme, viewport });
      for (const path of paths) {
        test(`${path} has no axe violations and no horizontal scrolling`, async ({ page }) => {
          await page.goto(`${DOCS}${path}`);
          await expect(page.locator('h1').first()).toBeVisible();
          const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
        });
      }
    });
  }
}

// Expressive Code gives a code block that scrolls sideways tabindex="0" and role="region" from a
// script, with no name of its own. Two such regions with no name fail axe's landmark-unique, and
// an unnamed region fails WCAG 4.1.2. site/src/lib/code-names.mjs names every block, so the test
// checks every block on every page, and then forces each one to scroll so the script makes them
// all regions at once, whatever the font or the snippet's width.
test.describe('docs code blocks, 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const path of paths) {
    test(`${path}: every code block has a distinct accessible name`, async ({ page }) => {
      await page.goto(`${DOCS}${path}`);
      await expect(page.locator('h1').first()).toBeVisible();
      const blocks = page.locator('.expressive-code pre');
      const count = await blocks.count();
      test.skip(count === 0, 'no code blocks on this page');
      // Force every block wider than the viewport. The script reacts to the resize.
      await page.addStyleTag({ content: '.expressive-code pre > code { display: block; min-width: 1200px; }' });
      await expect(page.locator('.expressive-code pre[role="region"]')).toHaveCount(count);
      const names = await blocks.evaluateAll((pres) => pres.map((pre) => (pre.getAttribute('aria-label') ?? '').trim()));
      expect(names.every(Boolean), `unnamed code block among ${JSON.stringify(names)}`).toBe(true);
      expect(new Set(names).size, `duplicate names ${JSON.stringify(names)}`).toBe(names.length);
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
    });
  }
});
