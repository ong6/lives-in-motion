import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        story: resolve(__dirname, "story.html"),
        styles: resolve(__dirname, "styles.html"),
      },
    },
  },
});
