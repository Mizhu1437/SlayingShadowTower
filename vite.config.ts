import { defineConfig } from 'vite';

// GitHub Pages 部署在 https://<user>.github.io/<repo>/ 这样的子路径下，
// 资源引用必须带上前缀，否则会去根域名找 /assets/* 而 404。
// 本地 dev 与 preview 不需要前缀，由 GH_PAGES 环境变量区分。
const isGhPages = process.env.GH_PAGES === '1';
const repoBase = '/Touhou-luyingta/';

export default defineConfig({
  base: isGhPages ? repoBase : '/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
