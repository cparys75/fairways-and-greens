/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` serves the UI only; point /api at a running `wrangler pages dev` (port 8788).
    proxy: { '/api': 'http://localhost:8788' },
  },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'functions/**/*.test.ts'] },
});
