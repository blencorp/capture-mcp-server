import { brand } from '@/brand';
import blenLogo from '@/assets/blen-logo.png';

// The maker's signature on every page; intentionally fixed, not operator-configurable.
const BLEN_URL = 'https://www.blencorp.com';
const BLEN_CONTACT_URL = 'https://www.blencorp.com/mcp';

const link = 'hover:text-foreground underline underline-offset-4';

/** "Built with love by BLEN", the docs and source, a way to reach BLEN, and the service policies. */
export function SiteFooter() {
  return (
    <footer className="text-muted-foreground border-t">
      <div className="mx-auto grid max-w-5xl gap-3 px-4 py-6 text-xs">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <li>
            <a href={BLEN_URL} className="hover:text-foreground inline-flex items-center gap-2">
              {/* The link text names BLEN; the logo is decoration. */}
              <img src={blenLogo} alt="" width={40} height={16} className="h-4 w-auto" />
              <span>
                Built with <span aria-hidden="true">❤️</span>
                <span className="sr-only">love</span> by BLEN
              </span>
            </a>
          </li>
          <li><a href={brand.docsUrl} className={link}>Docs</a></li>
          {brand.repoUrl && <li><a href={brand.repoUrl} className={link}>GitHub</a></li>}
          <li><a href={BLEN_CONTACT_URL} className={link}>Contact us</a></li>
          <li><a href="/privacy-policy" className={link}>Privacy</a></li>
          <li><a href="/terms" className={link}>Terms</a></li>
        </ul>
        <p>{brand.disclaimer}</p>
      </div>
    </footer>
  );
}
