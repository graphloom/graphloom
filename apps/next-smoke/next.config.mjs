/**
 * P6-T04 RSC smoke fixture: `next build` statically prerenders a Server
 * Component page that imports @graphloom/react — proving the package's
 * 'use client' boundary works in a real RSC tree. Build-only; nothing runs.
 * @type {import('next').NextConfig}
 */
export default {
  // Keep build output under dist/ (workspace gitignore + nx cache convention).
  distDir: 'dist',
};
