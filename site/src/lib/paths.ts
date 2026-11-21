/** A root-absolute site path with the deploy base in front, for links built in components. */
export const withBase = (path: string): string => import.meta.env.BASE_URL.replace(/\/$/, '') + path;
