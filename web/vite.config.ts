import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { prerender } from './prerender.ts';
import { thirdPartyNotices } from './third-party-notices.ts';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss(), thirdPartyNotices({ stylesheets: [fileURLToPath(new URL('./src/index.css', import.meta.url))] }),
    prerender({ entry: 'src/prerender.tsx', routes: { 'privacy-policy.html': '/privacy-policy', 'terms.html': '/terms' } }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    // The page CSP allows only same-origin files: no inline scripts or styles.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
