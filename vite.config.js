import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is set by the GitHub Pages workflow (e.g. /Dancing-with-the-SARs/); locally it is '/'.
const base = process.env.BASE_PATH || '/';
export default defineConfig({
  base,
  plugins: [react()],
  define: { CESIUM_BASE_URL: JSON.stringify(`${base}cesium`) },
  server: {
    proxy: {
      '/api/geocode': 'http://localhost:8000', '/api/analyze': 'http://localhost:8000', '/api/jobs': 'http://localhost:8000',
      '/api/usgs': { target: 'https://earthquake.usgs.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/usgs/, '/fdsnws/event/1') },
      '/api/eonet': { target: 'https://eonet.gsfc.nasa.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/eonet/, '/api/v3') },
      '/api/asf': {
        target: 'https://api.daac.asf.alaska.edu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/asf/, ''),
      },
    },
  },
  build: { chunkSizeWarningLimit: 6000 },
});
