import type { RequestHandler } from "./$types";

// Only the landing page is indexable. Review links stay crawlable so messaging
// apps can build link previews; their pages still send noindex.
export const GET: RequestHandler = ({ url }) =>
  new Response(
    `User-agent: *
Allow: /$
Allow: /r/
Allow: /landing/
Allow: /_app/
Allow: /favicon
Allow: /apple-touch-icon.png
Disallow: /

Sitemap: ${url.origin}/sitemap.xml
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
