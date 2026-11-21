import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';

import { Home } from '@/pages/home';
import { Policy } from '@/pages/policy';
import { NotFound } from '@/components/kit/error-page';

// Follow the system color scheme; shadcn's dark tokens apply under .dark.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/privacy-policy" element={<Policy kind="privacy" />} />
        <Route path="/terms" element={<Policy kind="terms" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);

// The policy pages arrive prerendered (web/prerender.ts): hydrate that markup in place, so nothing
// flashes and focus and the skip link keep working. Every other page starts from an empty root.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
