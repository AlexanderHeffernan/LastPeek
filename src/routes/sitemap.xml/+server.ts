import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${url.origin}/</loc>
    <changefreq>weekly</changefreq>
    <video:video>
      <video:thumbnail_loc>${url.origin}/landing/film-poster.jpg</video:thumbnail_loc>
      <video:title>LastPeek: take one last peek before you post</video:title>
      <video:description>A friend catches the typo and suggests a photo before the post goes out. See LastPeek in under a minute.</video:description>
      <video:content_loc>${url.origin}/landing/lastpeek-film.mp4</video:content_loc>
      <video:duration>47</video:duration>
    </video:video>
  </url>
</urlset>
`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
