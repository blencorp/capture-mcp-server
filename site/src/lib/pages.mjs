import * as product from '../../product.mjs';

// The site's pages, in sidebar order. The sidebar, the Markdown copy of each page, and the page
// actions are all built from this list. The labels below are the defaults, which suit a code-mode
// server. A product whose pages differ (a server with no SDK, say) overrides a page's sidebar
// label with `export const pageLabels = { 'reference/sdk': 'Search reference' }` in product.mjs,
// keyed by slug ('index' for the home page). The page's own title is set in its frontmatter.
const labels = product.pageLabels ?? {};
const page = (label, slug) => ({ label: labels[slug] ?? label, slug });

export const home = page('Overview', 'index');

export const groups = [
  {
    label: 'Start',
    pages: [
      page('Get your keys', 'keys'),
      page('Connect your assistant', 'connect'),
    ],
  },
  {
    label: 'Use',
    pages: [
      page('How it works', 'how-it-works'),
      page('Recipes', 'recipes'),
    ],
  },
  {
    label: 'Reference',
    pages: [
      page('Tools', 'reference/tools'),
      page('SDK reference', 'reference/sdk'),
    ],
  },
  {
    label: 'Run your own',
    pages: [
      page('Self-host', 'self-host'),
      page('Security', 'security'),
    ],
  },
];

export const pages = [home, ...groups.flatMap((group) => group.pages)];

// starlight-llms-txt writes one file for each document set and names it after the set's label,
// with the rule of a GitHub heading anchor. scripts/check-links.mjs fails the build if a file
// is not where this says.
const fileName = (label) => label.toLowerCase().replace(/[^a-z0-9 -]/g, '').replaceAll(' ', '-');

/** The site path of a page's Markdown copy, or undefined when the page has none. */
export const markdownPath = (slug) => {
  // Starlight gives the home page an empty id.
  const page = pages.find((candidate) => candidate.slug === (slug || home.slug));
  return page && `/_llms-txt/${fileName(page.label)}.txt`;
};
