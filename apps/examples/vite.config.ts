import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: `/` is the P3 rendering demo (visual-baselined — do not touch),
// `/editor.html` is the P4 interaction demo.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
});
