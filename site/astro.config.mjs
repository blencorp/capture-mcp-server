import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import { groups, pages } from './src/lib/pages.mjs';
import { base, description, distribution, llmsDetails, packageName, productName, repo, site, tagline } from './product.mjs';

// The hosted server serves the built site at /docs (deploy/Dockerfile builds it into the image;
// src/accounts/docs.ts serves it). To move it, change `site` and `base` here and the base in the
// two hero links in index.mdx and in scripts/check-links.mjs. Every other link is root-absolute.


// Astro adds `base` to its own assets and Starlight adds it to the sidebar, but neither touches
// a link written inside a page. The same pass makes tables keyboard-scrollable. This adds it to root-absolute links in Markdown and in MDX
// components, so pages can link to `/connect/` wherever the site is served.
function rehypeBase() {
  const prefix = (value) =>
    typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? base + value : value;
  const visit = (node) => {
    if (node.type === 'element' && node.tagName === 'a' && node.properties?.href !== undefined) {
      node.properties.href = prefix(node.properties.href);
    }
    // Starlight lets a wide table scroll sideways. A keyboard user can scroll it only if it can
    // take focus (WCAG 2.1.1), so it joins the tab order.
    if (node.type === 'element' && node.tagName === 'table') {
      node.properties = { ...node.properties, tabIndex: 0 };
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.name === 'href') attribute.value = prefix(attribute.value);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  return visit;
}

// A page's description from its frontmatter, for the page list in llms.txt. The SDK reference
// is a .md file that `pnpm sync` writes; every other page is .mdx.
function descriptionOf(slug) {
  for (const extension of ['mdx', 'md']) {
    try {
      const source = readFileSync(new URL(`./src/content/docs/${slug}.${extension}`, import.meta.url), 'utf8');
      return /^description: (.+)$/m.exec(source)?.[1];
    } catch {
      // Not this extension.
    }
  }
}

export default defineConfig({
  site,
  base,
  markdown: { processor: unified({ rehypePlugins: [rehypeBase] }) },
  integrations: [
    starlight({
      title: productName,
      description,
      favicon: '/favicon.svg',
      logo: { src: './src/assets/blen-logo-red.svg', alt: 'BLEN' },
      // Geist is BLEN's typeface. The rest of the theme is Starlight's default.
      customCss: ['@fontsource-variable/geist', '@fontsource-variable/geist-mono', './src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      head: [
        // The picture that a chat app or a social site shows with a link to the site.
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}${base}/og.png` } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content: `${productName}: ${tagline.charAt(0).toLowerCase()}${tagline.slice(1)}`,
          },
        },
      ],
      components: {
        // Adds the page actions: copy the page as Markdown, view it, or open it in an assistant.
        PageTitle: './src/components/PageTitle.astro',
        // Adds the links to llms.txt, llms-full.txt, and the page's Markdown copy.
        Footer: './src/components/Footer.astro',
      },
      // Adds each page's Markdown link to its <head>.
      routeMiddleware: './src/routeData.ts',
      sidebar: groups.map((group) => ({
        label: group.label,
        items: group.pages.map(({ label, slug }) => ({ label, slug })),
      })),
      plugins: [
        // llms.txt and the Markdown copies are files, not pages, so the validator cannot see them.
        starlightLinksValidator({ exclude: ['/llms.txt', '/llms-full.txt'] }),
        starlightLlmsTxt({
          details: llmsDetails,
          // One document set for each page: its Markdown copy, which the page actions link to.
          customSets: pages.map(({ label, slug }) => ({ label, paths: [slug], description: descriptionOf(slug) })),
          // The link icon beside each heading is noise in Markdown.
          customSelectors: { all: ['.sl-anchor-link'] },
          // The sets use the plugin's compact output. A page's Markdown copy keeps its notes and
          // its line breaks, which the compact output would remove.
          minify: { note: false, tip: false, details: false, whitespace: false },
          optionalLinks: [
            { label: 'Source code', url: repo, description: 'the server, its tests, and the long guides' },
            ...(distribution.npm
              ? [{ label: 'npm package', url: `https://www.npmjs.com/package/${packageName}`, description: 'the published server' }]
              : []),
          ],
        }),
      ],
    }),
  ],
});
