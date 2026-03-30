import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import obfuscator from 'rollup-plugin-obfuscator';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = `v${pkg.version}`;

const isProd = process.env.NODE_ENV === 'production' || process.env.TAURI_ENV_DEBUG === 'false';

export default defineConfig({
  plugins: [
    react(),
    // Production-only: obfuscate the JS bundle to protect frontend business logic.
    // String array encoding + rotation prevents trivial source extraction from the
    // installed Tauri app. Core algorithm is already in the compiled Rust engine binary.
    ...(isProd
      ? [
          obfuscator({
            options: {
              compact: true,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              stringArrayThreshold: 0.75,
              rotateStringArray: true,
              shuffleStringArray: true,
              splitStrings: false,
              controlFlowFlattening: false, // skip: too slow + minimal security gain
              deadCodeInjection: false,     // skip: increases bundle size
              debugProtection: false,
              disableConsoleOutput: true,
              selfDefending: false,         // skip: breaks strict CSP in WebView2
              sourceMap: false,
            },
          }),
        ]
      : []),
  ],

  // Tauri expects a static output in dist
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['chrome105', 'safari15'],  // WebView2 (Win) + WKWebView (macOS) baseline
    minify: 'esbuild',
    esbuild: isProd ? { drop: ['console', 'debugger'] } : undefined,
    sourcemap: false,
    reportCompressedSize: false,        // skip gzip computation to speed up builds
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'map-vendor': ['maplibre-gl'],
          'deck-vendor': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/geo-layers', '@deck.gl/mapbox'],
          'chart-vendor': ['recharts'],
          'motion-vendor': ['framer-motion'],
          'h3-vendor': ['h3-js'],
        },
      },
    },
  },

  // Development server config
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // Dev proxy: forward engine API calls to local eodi-engine server.
    // Start engine with: engine-server\target\release\eodi-engine.exe output\hexagons.edbh devtoken --port=17384
    proxy: {
      '/hex': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/engine/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/stats': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/countries': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/cities': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/user': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/_hb': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // Prevent vite from obscuring rust errors
  clearScreen: false,

  // Environment prefix for Tauri
  envPrefix: ['VITE_', 'TAURI_'],

  // Inject app version as global constant for WhatsNew versioned storage key
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
});
