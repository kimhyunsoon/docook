import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4347,
    strictPort: true,
    proxy: {
      // 로컬 개발: backend(:4346)로 API 프록시
      '/api': 'http://localhost:4346',
    },
  },
  build: {
    target: 'es2022',
  },
});
