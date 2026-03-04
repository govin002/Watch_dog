import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'path';

export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'src/main.ts',
            },
            preload: {
                input: 'src/preload.ts',
            },
            renderer: {},
        }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
