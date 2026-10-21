// Construit les deux versions de To do list :
//   dist/to-do-list.html   fichier unique, à ouvrir depuis le disque
//   dist/web/              version installable (GitHub Pages) : même page + manifeste, service worker, icônes
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const VERSION = '1.3.0';
const src = (p) => new URL(`./src/${p}`, import.meta.url);
const out = (p) => new URL(`./dist/${p}`, import.meta.url);
const b64 = (p) => readFileSync(src(`fonts/${p}`)).toString('base64');
const fonts = {
  FONT_B400: 'barlow-latin-400-normal.woff2',
  FONT_B500: 'barlow-latin-500-normal.woff2',
  FONT_B600: 'barlow-latin-600-normal.woff2',
  FONT_C500: 'barlow-semi-condensed-latin-500-normal.woff2',
  FONT_C600: 'barlow-semi-condensed-latin-600-normal.woff2',
};
let css = readFileSync(src('styles.css'), 'utf8');
for (const [k, f] of Object.entries(fonts)) css = css.split(`{{${k}}}`).join(b64(f));
const js = readFileSync(src('app.js'), 'utf8');
const template = readFileSync(src('index.html'), 'utf8');

const CSP_FILE = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
// Version web : le service worker et le manifeste viennent du même site ; aucune connexion de la page n'est permise.
const CSP_WEB = "default-src 'none'; script-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const HEAD_WEB = `
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`;

function page(csp, headExtra) {
  let html = template.split('{{CSS}}').join(css).split('{{JS}}').join(js)
    .split('{{VERSION}}').join(VERSION).split('{{CSP}}').join(csp).split('{{HEAD_EXTRA}}').join(headExtra);
  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) throw new Error('Placeholder non remplacé');
  return html;
}
mkdirSync(out(''), { recursive: true });
const fileHtml = page(CSP_FILE, '');
writeFileSync(out('to-do-list.html'), fileHtml);

rmSync(out('web'), { recursive: true, force: true });
mkdirSync(out('web/icons'), { recursive: true });
const webHtml = page(CSP_WEB, HEAD_WEB);
writeFileSync(out('web/index.html'), webHtml);
const build = createHash('sha256').update(webHtml).digest('hex').slice(0, 10);
writeFileSync(out('web/sw.js'), readFileSync(src('web/sw.js'), 'utf8').split('{{VERSION}}').join(VERSION).split('{{BUILD}}').join(build));
copyFileSync(src('web/manifest.webmanifest'), out('web/manifest.webmanifest'));
for (const f of readdirSync(src('web/icons'))) copyFileSync(src(`web/icons/${f}`), out(`web/icons/${f}`));
writeFileSync(out('web/.nojekyll'), '');
writeFileSync(out('web/404.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./"><title>To do list</title>');
console.log('OK', `fichier ${(fileHtml.length / 1024).toFixed(0)} Ko, web ${(webHtml.length / 1024).toFixed(0)} Ko, build ${build}`);
