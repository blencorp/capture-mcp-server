import type { Brand } from '@/components/kit/brand';

export const brand: Brand = {
  name: 'Capture MCP',
  tagline: 'Federal procurement data in your AI assistant',
  summary:
    'Search contract opportunities, vendors, awards, grants and forecasts from SAM.gov, USAspending, Tango and HigherGov, in Claude, ChatGPT, Cursor and other MCP clients.',
  repoUrl: 'https://github.com/blen-labs/capture-mcp-server',
  docsUrl: '/docs/',
  license: 'Apache-2.0',
  disclaimer: 'Independent open-source project; not affiliated with or endorsed by SAM.gov, USAspending.gov, Tango or HigherGov.',
  accounts: false,
  accountPurpose: 'connect your SAM.gov, Tango and HigherGov keys',
  connect: {
    signInStep: (
      <>
        Your assistant opens a page from this server. Tick the sources you use and paste your own key for each:
        SAM.gov, Tango and HigherGov. You need at least one, and a tool needs only its own source&rsquo;s key. There is no
        account and nothing is stored on the server: the keys travel inside the token your assistant keeps.{' '}
        <a href="/docs/keys/" className="text-foreground underline underline-offset-4">
          How to get the keys
        </a>
        .
      </>
    ),
    guidesHref: '/docs/connect/',
  },
  examples: [
    { title: 'Open opportunities', prompt: 'Find SAM.gov opportunities posted this month for NAICS 541512 that are set aside for small businesses.' },
    { title: 'Vendor check', prompt: 'Is the entity with UEI ABC123DEF456 registered in SAM.gov, and does it have any active exclusions?' },
    { title: 'Agency spending', prompt: 'Show the largest spending categories for the Department of Veterans Affairs in fiscal year 2025.' },
    { title: 'Recompete watch', prompt: 'Which Tango IDVs for the Army expire in the next twelve months?' },
    { title: 'Forecasts', prompt: 'List HigherGov forecasts for cybersecurity services from the Department of Homeland Security.' },
    { title: 'Set-aside codes', prompt: 'What is the difference between set-aside codes 8A and 8AN?' },
  ],
  sources: [
    { name: 'SAM.gov', description: 'Contract opportunities, entity registrations and exclusions. Needs your SAM.gov key.', href: '/docs/reference/tools/' },
    { name: 'USAspending', description: 'Federal awards, spending by category and agency budgetary resources. No key needed.', href: '/docs/reference/tools/' },
    { name: 'Tango', description: 'Contracts, grants, vendors, protests, IDVs, vehicles and OTAs from one unified API. Needs your Tango key.', href: '/docs/reference/tools/' },
    { name: 'HigherGov', description: 'Opportunities, forecasts, contracts and contacts, including saved searches. Needs your HigherGov key.', href: '/docs/reference/tools/' },
    { name: 'Reference codes', description: 'Official FPDS descriptions for set-asides, contract types and other procurement codes.', href: '/docs/reference/tools/' },
  ],
  howItWorks: [
    {
      title: 'Narrow tools',
      body: 'Each question maps to one focused tool, such as a SAM.gov opportunity search or a USAspending category breakdown, with filters that say what was applied upstream.',
    },
    {
      title: 'Your own keys',
      body: 'Each source issues keys to you. Yours are sealed inside your access token and used only for your requests; the server never uses an operator key for anyone.',
    },
    {
      title: 'Honest failures',
      body: 'A failed call says why: the key was missing or refused, the source was rate limiting, or it could not be reached. Totals show as unknown when they cannot be trusted.',
    },
  ],
  howItWorksHref: '/docs/how-it-works/',
};
