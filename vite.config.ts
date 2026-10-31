import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@sveltejs/adapter-node";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      alias: { $lib: "./src/lib" },
      // Kit 3 reads the fixed CSRF/adapter origin at build time, not server startup.
      paths: { origin: process.env.ORIGIN || undefined },
      csp: {
        directives: {
          "default-src": ["self"],
          "script-src": ["self"],
          "frame-src": ["none"],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "blob:", "https://pbs.twimg.com"],
          "media-src": ["self", "blob:", "https://video.twimg.com"],
          "object-src": ["none"],
          "base-uri": ["self"],
          "frame-ancestors": ["none"],
        },
      },
    }),
  ],
  server: { allowedHosts: process.env.AMP_ORB ? true : undefined },
});
