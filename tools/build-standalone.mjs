// Bundle the split-file tracker into ONE self-contained HTML you can hand to anyone.
//
//   node tools/build-standalone.mjs
//
// The dev layout keeps the engine, styles, scores, and neural voice packs in SEPARATE files so the
// standalone prototype and the Next /tracker route load the *exact same* tracker-engine.js (one
// engine, no drift). Great for building; wrong for sharing — a lone .html on someone's Desktop
// can't find its siblings. This inlines every local <link rel=stylesheet> and <script src> from the
// shell into a single dist/speech-score.html: no build, no network, no folder. Double-click it
// offline on any machine and the full scene plays — text, timing, casting, and neural audio.
//
// Reproducible artifact — output is gitignored (dist/); this script is the durable, committed thing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = path.join(ROOT, 'apps/web/public/prototypes');
const SHELL = path.join(PROTO, 'philip-glass-tracker.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'speech-score.html');
const ARTWORK_RELATIVE_PATHS = [
  'artwork/lady-macbeth-macbeth-painting.png',
  'artwork/philip-glass-abstract-composition-1994.webp',
  'artwork/richard-anne-portrait-woman-1590.webp',
  'artwork/earnest-de-brug-1895.webp',
  'artwork/macbeth-witches-savery-1615.webp',
];

const readLocal = (href) => {
  const file = path.join(PROTO, href);
  if (!file.startsWith(PROTO)) throw new Error(`refusing to inline outside prototypes/: ${href}`);
  return fs.readFileSync(file, 'utf8');
};

// A stray "</script>" inside inlined JS would close the wrapping tag early — neutralize it. Harmless
// to the JS (the sequence never legitimately appears in these data/engine files) and standard.
const safeJs = (src) => src.replace(/<\/script>/gi, '<\\/script>');

const mimeType = (file) => {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  throw new Error(`refusing to inline unsupported image type: ${file}`);
};

const inlineImage = (publicPath, relativePath) => {
  const file = path.join(PROTO, relativePath);
  if (!file.startsWith(PROTO)) throw new Error(`refusing to inline outside prototypes/: ${relativePath}`);
  if (!fs.existsSync(file)) throw new Error(`missing standalone image: ${file}`);
  const dataUri = `data:${mimeType(file)};base64,${fs.readFileSync(file).toString('base64')}`;
  if (!html.includes(publicPath)) throw new Error(`standalone image path not found: ${publicPath}`);
  html = html.replaceAll(publicPath, dataUri);
  inlined.push(relativePath);
};

let html = fs.readFileSync(SHELL, 'utf8');
const inlined = [];

// Inline <link rel="stylesheet" href="local.css"> -> <style>...</style>
html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = tag.match(/\bhref=["']([^"']+)["']/i);
  if (!m || /^(https?:)?\/\//i.test(m[1]) || m[1].startsWith('data:')) return tag;
  inlined.push(m[1]);
  return `<style>\n${readLocal(m[1])}\n</style>`;
});

// Inline <script src="local.js"></script> -> <script>...</script>
html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return tag;
  inlined.push(src);
  return `<script>\n${safeJs(readLocal(src))}\n</script>`;
});

for (const relativePath of ARTWORK_RELATIVE_PATHS) {
  inlineImage(`/prototypes/${relativePath}`, relativePath);
}

const banner = `<!-- BUILT — single-file bundle of the speech-score tracker. Do not edit by hand.
     Source: apps/web/public/prototypes/ (${inlined.length} files inlined). Rebuild: node tools/build-standalone.mjs -->\n`;
html = html.replace(/^<!doctype html>/i, `<!doctype html>\n${banner}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`WROTE ${path.relative(ROOT, OUT)} — ${kb} KB, ${inlined.length} files inlined:`);
for (const f of inlined) console.log(`  + ${f}`);
console.log('\nHand this one file to anyone. It opens offline by double-click.');
