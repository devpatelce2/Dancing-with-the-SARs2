import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev (`npm run dev`) is served from '/', so /data, /api/... and /cesium all resolve.
// Production build for GitHub Pages is served from the repository sub-path. Override with VITE_BASE if you deploy elsewhere
// (for example VITE_BASE=/ for Vercel).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE ?? (command === 'build' ? '/Dancing-with-the-SARs2/' : '/'),
  server: {
    proxy: {
      '/api/geocode': 'http://localhost:8000', '/api/analyze': 'http://localhost:8000', '/api/jobs': 'http://localhost:8000',
      '/api/usgs': { target: 'https://earthquake.usgs.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/usgs/, '/fdsnws/event/1') },
      '/api/eonet': { target: 'https://eonet.gsfc.nasa.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/eonet/, '/api/v3') },
      '/api/asf': { target: 'https://api.daac.asf.alaska.edu', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/asf/, '') },
    },
  },
  build: { chunkSizeWarningLimit: 6000 },
}))
