import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // Admin 站点通过 nginx 挂载在 /admin/ 下，必须设置 base，
  // 否则构建产物会引用 /assets/* 导致加载到 desktop 的静态资源或 404，页面白屏。
  base: "/admin/",
  plugins: [vue()],
  server: {
    port: 5174
  }
});
