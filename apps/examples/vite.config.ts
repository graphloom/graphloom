import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Five pages: `/` is the P3 rendering demo (visual-baselined — do not
// touch), `/editor.html` is the P4 interaction demo, `/gallery.html` is the
// P7 shape/theme gallery (visual-baselined per theme), `/worker-layout.html`
// is the P8 worker-execution proof (model state only, no baseline), and
// `/bench.html` is the P9-T03 synthetic-graph fixture (headless harness only,
// no baseline).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        gallery: resolve(import.meta.dirname, 'gallery.html'),
        workerLayout: resolve(import.meta.dirname, 'worker-layout.html'),
        bench: resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
});
