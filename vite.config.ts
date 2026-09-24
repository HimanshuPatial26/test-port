import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from any static host sub-path
  // (GitHub Pages, Netlify, S3, a /portfolio/ folder, …).
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // three.js (~170 KB gzip) is lazy-loaded with the scene, never on the critical path.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Keep three.js in its own chunk: it is only fetched when the 3D scene loads.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
