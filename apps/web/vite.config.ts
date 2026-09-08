import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时把 /api 与代理请求代理到本地 API 服务，避免 CORS。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/health": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
