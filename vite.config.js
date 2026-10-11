import { defineConfig } from 'vite';

export default defineConfig({
  // statue.glb is referenced with new URL(..., import.meta.url) and copied as a hashed asset
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0, // keep the GLB, fonts and Lottie JSON as separate cacheable files
    chunkSizeWarningLimit: 900, // three.js lives in the lazily loaded stage chunk
  },
});
