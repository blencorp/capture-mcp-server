import type { ReactNode } from 'react';

/**
 * Everything product-specific the shared portal kit shows. Each server's `src/brand.tsx`
 * exports one of these; the kit components (`components/kit/*`) are identical in every repo.
 */
export interface Brand {
  /** Product name, as in the header and page titles ("Patents & Trademarks MCP"). */
  name: string;
  /** Landing page heading. */
  tagline: string;
  /** One or two sentences under the heading. */
  summary: string;
  /**
   * Public source repository. Leave it out while the repository is not public: the header,
   * footer and landing page then show no source links.
   */
  repoUrl?: string;
  /** Documentation site root, served by this server ("/docs/"). */
  docsUrl: string;
  /** SPDX license id of the source. */
  license: string;
  /** Shown in the footer, e.g. "Independent open-source project; not affiliated with …". */
  disclaimer: string;
  /**
   * Set to `false` for a server with no user accounts (its hosted service authorizes with a
   * key form instead). The header then has no sign-in/account link, the landing page no
   * account button, and nothing checks for a session. Omit it for the default: accounts.
   */
  accounts?: false;
  /** What signing in is for, completing "Sign in to …" ("manage your USPTO API keys"). */
  accountPurpose: string;
  connect: {
    /** Step 3 of connecting: what happens at sign-in (e.g. adding an API key). */
    signInStep: ReactNode;
    /** When the anonymous endpoint exists: what it can do without signing in. */
    publicNote?: ReactNode;
    /** Docs page with per-client connection guides. */
    guidesHref: string;
  };
  /** Prompts that show what the server is good at. */
  examples: { title: string; prompt: string }[];
  /** The upstream data sources. */
  sources: { name: string; description: string; href?: string }[];
  /** Three or four short points about how the server works. */
  howItWorks: { title: string; body: string }[];
  /** Docs page that explains the design in depth. */
  howItWorksHref: string;
}
