import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@sveltejs/adapter-node";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      alias: { $lib: "./src/lib" },
      // Kit 3 reads the fixed CSRF/adapter origin at build time, not server startup.
      paths: { origin: process.env.ORIGIN || undefined },
      csp: {
        directives: {
          "default-src": ["self"],
          "script-src": ["self"],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "blob:"],
          "media-src": ["self", "blob:"],
          "object-src": ["none"],
          "base-uri": ["self"],
          "frame-ancestors": ["none"],
        },
      },
    }),
  ],
  server: { allowedHosts: process.env.AMP_ORB ? true : undefined },
});
