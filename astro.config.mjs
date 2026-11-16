import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import svelte from "@astrojs/svelte";

export default defineConfig({
  output: "server",
  session: false,
  adapter: node({ mode: "standalone" }),
  integrations: [svelte()],
  devToolbar: { enabled: false },
});
