import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Dancing-with-the-SARs2/',
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
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
