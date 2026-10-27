import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: process.env.PUBLIC_APP_ORIGIN || 'http://localhost:4321',
  output: 'static',
  session: false,
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [react()],
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ],
    },
  },
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: false },
  vite: {
    server: { strictPort: true },
    resolve: { dedupe: ['react', 'react-dom'] },
  },
});
