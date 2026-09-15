import { defineConfig } from "vite";
export default defineConfig({
  root: "src/web",
  build: { assetsInlineLimit: 0, outDir: "../../dist/web-dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            if (incoming.headers.origin && incoming.headers.origin !== `http://${incoming.headers.host}`) {
              request.destroy(new Error("Cross-origin development request rejected"));
              return;
            }
            request.setHeader(
              "origin",
              "http://127.0.0.1:3000",
            );
          });
        },
      },
    },
  },
});
