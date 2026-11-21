export interface DocPage { label: string; slug: string }
export const home: DocPage;
export const groups: { label: string; pages: DocPage[] }[];
export const pages: DocPage[];
export function markdownPath(id: string): string | undefined;
