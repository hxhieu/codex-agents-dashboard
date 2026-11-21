import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  srcDir: './android/web',
  outDir: './android/build/assets/site',
  cacheDir: './android/build/astro-cache',
  session: false,
  integrations: [svelte()],
});
