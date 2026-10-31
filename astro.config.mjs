import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://josh.hu',
  base: '/rtxspark',
  trailingSlash: 'always',
  output: 'static',
  build: {
    format: 'directory',
    // joshhu.github.io is built by Jekyll, which drops directories starting with "_".
    assets: 'assets',
  },
  devToolbar: { enabled: false },
});
