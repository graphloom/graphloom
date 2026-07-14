import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Three pages: `/` is the P3 rendering demo (visual-baselined — do not
// touch), `/editor.html` is the P4 interaction demo, `/gallery.html` is the
// P7 shape/theme gallery (visual-baselined per theme).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        gallery: resolve(import.meta.dirname, 'gallery.html'),
      },
    },
  },
});
