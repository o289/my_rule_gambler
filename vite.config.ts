import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'three'] },
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    proxy: {
      '/dice-ws': {
        target: `ws://127.0.0.1:${process.env.DICE_PORT ?? '8788'}`,
        ws: true,
        changeOrigin: false,
        rewrite: path => path.replace(/^\/dice-ws$/, '/ws'),
      },
      '/casino-ws': {
        target: `ws://127.0.0.1:${process.env.CASINO_PORT ?? '8791'}`,
        ws: true,
        changeOrigin: false,
        rewrite: path => path.replace(/^\/casino-ws$/, '/ws'),
      },
    },
  },
});
