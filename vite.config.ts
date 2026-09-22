import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'export-asset-manifest',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const publicFiles = readdirSync('public', {
            recursive: true,
            withFileTypes: true,
          })
            .filter((entry) => entry.isFile())
            .map((entry) =>
              `${entry.parentPath}/${entry.name}`.replace(/^public\//, ''),
            );
          this.emitFile({
            type: 'asset',
            fileName: 'asset-manifest.json',
            source: JSON.stringify([...Object.keys(bundle), ...publicFiles]),
          });
        },
      },
    },
  ],
  build: {
    rollupOptions: {
      input: { main: 'index.html', projects: 'projects.html' },
    },
  },
});
