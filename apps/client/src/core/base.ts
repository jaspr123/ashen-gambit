// Deploy-path awareness. The client can be served from a sub-path (e.g.
// https://ai.jteam.ca/Ashengambit/) behind a reverse proxy that strips the
// prefix before it reaches the server. Root-relative URLs used by the game
// ("/assets/…", "/api/…", "/uploads/…") go through `withBase` so they resolve
// under that prefix. Vite sets BASE_URL from `base` (VITE_BASE at build time).

export const BASE = import.meta.env.BASE_URL || '/';

export function withBase(url: string): string {
  if (BASE === '/' || !url.startsWith('/') || url.startsWith('//') || url.startsWith(BASE)) return url;
  return BASE + url.slice(1);
}
