// Construit les deux versions de To do list :
//   dist/to-do-list.html   fichier unique, à ouvrir depuis le disque
//   dist/web/              version installable (GitHub Pages) : même page + manifeste, service worker, icônes
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const VERSION = '1.7.1';
// Serveur de synchronisation (adresse et clé publique du projet Supabase ; vides = synchronisation désactivée)
let CLOUD = { url: '', anonKey: '' };
try { CLOUD = { ...CLOUD, ...JSON.parse(readFileSync(new URL('./cloud.config.json', import.meta.url), 'utf8')) }; } catch (e) { /* pas de configuration */ }
if (process.env.CLOUD_URL) CLOUD = { url: process.env.CLOUD_URL, anonKey: process.env.CLOUD_KEY || '' };
CLOUD.url = (CLOUD.url || '').replace(/\/+$/, '');
// Adresse publique de la version web : la CSP n'autorise que SES fichiers (pas tout le domaine github.io,
// partagé avec les autres sites du compte).
const PAGES_URL = (process.env.PAGES_URL || 'https://kgrebachev-afk.github.io/to-do-list/').replace(/\/?$/, '/');
const PAGES_PATH = new URL(PAGES_URL).pathname;
// Point d'accès des tests (window.__odj) : uniquement dans les versions de test.
const TEST_HOOKS = process.env.TEST_HOOKS === '1';
const src = (p) => new URL(`./src/${p}`, import.meta.url);
const OUT = process.env.OUT_DIR ? new URL(`file://${process.env.OUT_DIR.replace(/\/?$/, '/')}`) : new URL('./dist/', import.meta.url);
const out = (p) => new URL(p, OUT);
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
const qr = readFileSync(src('vendor/qrcode.min.js'), 'utf8');
const jsqr = readFileSync(src('vendor/jsqr.min.js'));
const JSQR_SRI = `sha384-${createHash('sha384').update(jsqr).digest('base64')}`;
let jsBase = readFileSync(src('app.js'), 'utf8').split('{{QR_JS}}').join(qr).split('{{JSQR_SRI}}').join(JSQR_SRI);
if (!TEST_HOOKS) {
  jsBase = jsBase.replace(/\/\*@test\*\/[\s\S]*?\/\*@endtest\*\//g, '');
  if (jsBase.includes('__odj')) throw new Error('Point d\'accès de test resté dans la version publiée');
}
const template = readFileSync(src('index.html'), 'utf8');

// Le script de la page est autorisé par son empreinte (aucun autre script en ligne ne peut s'exécuter).
const CSP_FILE = "default-src 'none'; script-src {{SCRIPT_HASH}}; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
// Version web : le service worker et le manifeste viennent du même site ; aucune connexion de la page n'est permise.
const CSP_WEB = `default-src 'none'; script-src ${PAGES_URL}jsqr.js {{SCRIPT_HASH}}; worker-src ${PAGES_URL}sw.js; manifest-src 'self'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob:; connect-src ${CLOUD.url || "'none'"}; form-action 'none'; base-uri 'none'`;
const HEAD_WEB = `
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`;

function page(csp, headExtra, cloud) {
  const js = jsBase.split('{{VERSION}}').join(VERSION).split('{{CLOUD_URL}}').join(cloud ? CLOUD.url : '').split('{{CLOUD_KEY}}').join(cloud ? CLOUD.anonKey : '');
  let html = template.split('{{CSS}}').join(css)
    .split('{{VERSION}}').join(VERSION).split('{{CSP}}').join(csp).split('{{HEAD_EXTRA}}').join(headExtra);
  // empreinte du contenu exact de la balise <script> (y compris les retours à la ligne autour)
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m || html.split('<script>').length !== 2) throw new Error('Un seul script en ligne attendu');
  const body = m[1].split('{{JS}}').join(js);
  const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
  html = html.split('{{SCRIPT_HASH}}').join(hash).split('{{JS}}').join(js);
  { const left = html.match(/\{\{[A-Z0-9_]+\}\}/); if (left) throw new Error('Placeholder non remplacé : ' + left[0]); }
  return html;
}
mkdirSync(out(''), { recursive: true });
const fileHtml = page(CSP_FILE, '', false);
writeFileSync(out('to-do-list.html'), fileHtml);

rmSync(out('web'), { recursive: true, force: true });
mkdirSync(out('web/icons'), { recursive: true });
const webHtml = page(CSP_WEB, HEAD_WEB, true);
writeFileSync(out('web/index.html'), webHtml);
const build = createHash('sha256').update(webHtml).digest('hex').slice(0, 10);
writeFileSync(out('web/sw.js'), readFileSync(src('web/sw.js'), 'utf8').split('{{VERSION}}').join(VERSION).split('{{BUILD}}').join(build));
copyFileSync(src('web/manifest.webmanifest'), out('web/manifest.webmanifest'));
copyFileSync(src('vendor/jsqr.min.js'), out('web/jsqr.js')); // lecteur de QR code, chargé à la demande
for (const f of readdirSync(src('web/icons'))) copyFileSync(src(`web/icons/${f}`), out(`web/icons/${f}`));
writeFileSync(out('web/.nojekyll'), '');
copyFileSync(new URL('./THIRD_PARTY_LICENSES.txt', import.meta.url), out('web/THIRD_PARTY_LICENSES.txt'));
copyFileSync(src('fonts/OFL.txt'), out('web/OFL.txt'));
writeFileSync(out('web/404.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${PAGES_PATH}"><title>To do list</title>`);
console.log(CLOUD.url ? `synchronisation : ${CLOUD.url}` : 'synchronisation : non configurée');
console.log(`adresse : ${PAGES_URL}${TEST_HOOKS ? ' (version de test)' : ''}`);
console.log('OK', `fichier ${(fileHtml.length / 1024).toFixed(0)} Ko, web ${(webHtml.length / 1024).toFixed(0)} Ko, build ${build}`);
