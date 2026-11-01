import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { snapshotPlugin } from './src/server/snapshotPlugin';

export default defineConfig({
  plugins: [react(), snapshotPlugin()],
});
