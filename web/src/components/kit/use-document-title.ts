import { useEffect } from 'react';
import { brand } from '@/brand';

/** Sets the browser tab title for this page: "<page> · <product>", or the product alone. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title && title !== brand.name ? `${title} · ${brand.name}` : brand.name;
  }, [title]);
}
