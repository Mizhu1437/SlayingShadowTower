import { defineConfig } from 'vite';

// GitHub Pages 部署在 https://<user>.github.io/<repo>/ 这样的子路径下，
// 资源引用必须带上前缀，否则会去根域名找 /assets/* 而 404。
// 本地 dev 与 preview 不需要前缀，由 GH_PAGES 环境变量区分。
const isGhPages = process.env.GH_PAGES === '1';
const repoBase = '/SlayingShadowTower/';

export default defineConfig({
  base: isGhPages ? repoBase : '/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    // 生产构建不输出 sourcemap。
    //
    // 原因：开启后会在 dist/ 里生成体积约为 JS 五倍的 .map 文件，
    // 部署到 GitHub Pages 后任何人都能下载并还原出完整源码。
    // 开发时需要源码映射，但那时用的是 Vite dev server，不依赖这个开关。
    sourcemap: false,
  },
});
