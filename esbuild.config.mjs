import { build, context } from 'esbuild';
import { readFile } from 'node:fs/promises';

const production = process.argv.includes('production');
const notices = await Promise.all([
  'LICENSE', 'licenses/unicode-segmentation_MIT.txt',
].map(file => readFile('node_modules/unicode-segmenter/' + file, 'utf8')));
const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  minify: production,
  sourcemap: production ? false : 'inline',
  banner: { js: '/* unicode-segmenter\n' + notices.join('\n') + '\n*/' },
};
if (production) await build(options);
else await (await context(options)).watch();
