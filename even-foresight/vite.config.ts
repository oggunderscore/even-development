import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      // Single entry point. index.html hosts both the phone webapp UI and the
      // glasses runtime — they share one WebView and one localStorage.
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
  },
});
