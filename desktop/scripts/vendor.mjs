// Copies the libraries the website loads from CDNs into desktop/vendor/, so the desktop app
// starts without internet: Supabase JS (one ES module) and the two Google Fonts (woff2).
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor');
const nm = join(root, 'node_modules');
mkdirSync(join(out, 'fonts'), { recursive: true });

await build({
  stdin: { contents: "export * from '@supabase/supabase-js';", resolveDir: root },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  outfile: join(out, 'supabase.js'), logLevel: 'warning',
});

const fonts = [
  ['Space Grotesk', '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', '300 700'],
  ['Inter', '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', '100 900'],
];
let css = '';
for (const [family, file, weight] of fonts) {
  const name = file.split('/').pop();
  copyFileSync(join(nm, file), join(out, 'fonts', name));
  css += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weight};src:url(/vendor/fonts/${name}) format('woff2')}\n`;
}
writeFileSync(join(out, 'fonts.css'), css);
console.log('vendor: supabase.js + fonts ready');
