(() => {
'use strict';

/* =====================================================================
   To do list — version Bureau
   Un seul fichier, aucune dépendance, aucune connexion réseau.
   ===================================================================== */

const APP = 'ordre-du-jour'; // identifiant interne du format de données (inchangé pour compatibilité)
const APP_NAME = 'To do list';
const SCHEMA = 1;
const VERSION = '{{VERSION}}';
const KEY_DATA = 'odj.data.v1';
const KEY_SNAPS = 'odj.snapshots.v1';
const KEY_BACKUP = 'odj.backup.v1';
const MAX_UNDO = 100;
const MAX_SNAPS = 7;

const DEFAULT_SETTINGS = Object.freeze({ theme: 'auto', addTo: 'bottom', holidays: true, doneTodayOpen: false, urgentDays: 2, remindTime: '09:00', remindSound: true, remindSticky: true });

/* ---------- Utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const LIG = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss' };
const foldChar = (c) => LIG[c] || c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fold = (s) => { let o = ''; for (const c of String(s ?? '')) o += foldChar(c); return o; };
/* Version repliée + position d'origine de chaque caractère replié (pour surligner juste). */
function foldMap(s) {
  let f = '';
  const start = [], end = [];
  let i = 0;
  for (const c of String(s ?? '')) {
    const fc = foldChar(c);
    for (let k = 0; k < fc.length; k++) { start.push(i); end.push(i + c.length); }
    f += fc; i += c.length;
  }
  return { f, start, end };
}
const nfc = (s) => (typeof s === 'string' ? s.normalize('NFC') : '');
const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const str = (v) => (typeof v === 'string' ? v.normalize('NFC') : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => matchMedia('(max-width: 860px)').matches;

const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,80}$/.test(v) && v !== '__settings'; // 80 : limite du serveur
function uid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* contexte non sécurisé */ }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => t !== null;
  return d;
}

/* ---------- Dates (toujours en heure locale, format AAAA-MM-JJ) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(fromISO(s)) === s;
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const diffDays = (a, b) => Math.round((fromISO(a) - fromISO(b)) / 86400000);
const dayOfMs = (ms) => toISO(new Date(ms));

const dtf = (o) => new Intl.DateTimeFormat('fr-FR', o);
const F_WDAY = dtf({ weekday: 'long' });
const F_SHORT = dtf({ weekday: 'short', day: 'numeric', month: 'short' });
const F_DM = dtf({ day: 'numeric', month: 'short' });
const F_DMY = dtf({ day: 'numeric', month: 'short', year: 'numeric' });
const F_LONG = dtf({ weekday: 'long', day: 'numeric', month: 'long' });
const F_LONGY = dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const F_FULL = dtf({ day: 'numeric', month: 'long', year: 'numeric' });
const F_DMONTH = dtf({ day: 'numeric', month: 'long' });
const F_TIME = dtf({ hour: '2-digit', minute: '2-digit' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function isoWeek(iso) {
  const x = fromISO(iso);
  const d = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
}
function weekStart(iso) { const d = fromISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); }
function shortDate(iso) {
  const d = fromISO(iso);
  return d.getFullYear() === new Date().getFullYear() ? F_SHORT.format(d) : F_DMY.format(d);
}
function longDate(iso) {
  const d = fromISO(iso);
  return d.getFullYear() === new Date().getFullYear() ? F_LONG.format(d) : F_LONGY.format(d);
}
function dueInfo(due) {
  const n = diffDays(due, todayISO());
  if (n === 0) return { text: "Aujourd'hui", cls: 'today', title: "Échéance aujourd'hui" };
  if (n === 1) return { text: 'Demain', cls: 'soon', title: 'Échéance demain' };
  if (n === -1) return { text: 'Hier', cls: 'late', title: "En retard d'un jour" };
  if (n < 0) return { text: F_DM.format(fromISO(due)), cls: 'late', title: `En retard de ${-n} jours` };
  if (n < 7) return { text: cap(F_WDAY.format(fromISO(due))), cls: '', title: `Échéance ${longDate(due)}` };
  return { text: shortDate(due), cls: '', title: `Échéance ${longDate(due)}` };
}

/* Jours fériés en France métropolitaine */
const holidayCache = new Map();
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(y, month - 1, day));
}
function holidays(y) {
  if (!holidayCache.has(y)) {
    const e = easterSunday(y);
    holidayCache.set(y, new Set([
      `${y}-01-01`, addDays(e, 1), `${y}-05-01`, `${y}-05-08`, addDays(e, 39), addDays(e, 50),
      `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`,
    ]));
  }
  return holidayCache.get(y);
}
function isWorkday(iso) {
  const d = fromISO(iso), wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !(state.settings.holidays && holidays(d.getFullYear()).has(iso));
}
function workdaysOfMonth(y, m) { // m : 0-11
  const out = [];
  const last = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= last; d++) { const iso = toISO(new Date(y, m, d)); if (isWorkday(iso)) out.push(iso); }
  return out;
}

/* ---------- Répétitions ---------- */
const REPEAT_LABELS = {
  none: 'Ne se répète pas',
  workday: 'Chaque jour ouvré',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois, même date',
  nth: 'Chaque mois, Nᵉ jour ouvré',
  last: 'Chaque mois, dernier jour ouvré',
};
function normRepeat(r) {
  if (!r || typeof r !== 'object' || !REPEAT_LABELS[r.type] || r.type === 'none') return null;
  const out = { type: r.type };
  if (r.type === 'weekly') out.wd = Number.isInteger(r.wd) && r.wd >= 0 && r.wd <= 6 ? r.wd : 1;
  if (r.type === 'monthly') out.dom = Number.isInteger(r.dom) && r.dom >= 1 && r.dom <= 31 ? r.dom : 1;
  if (r.type === 'nth') out.n = Number.isInteger(r.n) && r.n >= 1 && r.n <= 23 ? r.n : 1;
  return out;
}
function makeRepeat(type, anchorISO, n) {
  if (type === 'none') return null;
  const d = fromISO(anchorISO);
  if (type === 'weekly') return { type, wd: d.getDay() };
  if (type === 'monthly') return { type, dom: d.getDate() };
  if (type === 'nth') return { type, n: Math.min(23, Math.max(1, n || 1)) };
  return { type };
}
function occurrenceInMonth(rep, y, m) {
  if (rep.type === 'monthly') return toISO(new Date(y, m, Math.min(rep.dom, new Date(y, m + 1, 0).getDate())));
  const wds = workdaysOfMonth(y, m);
  if (!wds.length) return null;
  if (rep.type === 'last') return wds[wds.length - 1];
  return wds[Math.min(rep.n, wds.length) - 1];
}
/* Première occurrence strictement après `after` (ou à partir de, si inclusive). */
function nextOccurrence(rep, after, inclusive = false) {
  const ok = (iso) => (inclusive ? iso >= after : iso > after);
  if (rep.type === 'workday') {
    let d = inclusive ? after : addDays(after, 1);
    for (let i = 0; i < 400 && !isWorkday(d); i++) d = addDays(d, 1);
    return d;
  }
  if (rep.type === 'weekly') {
    const cur = fromISO(after).getDay();
    let delta = (rep.wd - cur + 7) % 7;
    if (delta === 0 && !inclusive) delta = 7;
    return addDays(after, delta);
  }
  const a = fromISO(after);
  for (let k = 0; k < 36; k++) {
    const y = a.getFullYear() + Math.floor((a.getMonth() + k) / 12);
    const m = (a.getMonth() + k) % 12;
    const iso = occurrenceInMonth(rep, y, m);
    if (iso && ok(iso)) return iso;
  }
  return addDays(after, 30);
}
function repeatSentence(rep) {
  if (!rep) return '';
  switch (rep.type) {
    case 'workday': return 'Se répète chaque jour ouvré';
    case 'weekly': return `Se répète chaque ${F_WDAY.format(new Date(2026, 0, 4 + rep.wd))}`;
    case 'monthly': return `Se répète chaque mois, le ${rep.dom === 1 ? '1er' : rep.dom}`;
    case 'nth': return `Se répète chaque mois, le ${rep.n === 1 ? '1er' : rep.n + 'ᵉ'} jour ouvré`;
    case 'last': return 'Se répète chaque mois, le dernier jour ouvré';
    default: return '';
  }
}

/* ---------- Rappels : modèle ----------
   remind = { date: 'AAAA-MM-JJ', time: 'HH:MM', fired, ack, snooze, firedAt }
   fired : l'heure prévue est passée et le rappel est parti ; ack : l'utilisateur l'a traité ;
   snooze : horodatage d'un report (prime sur l'heure prévue). */
const isHM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function normRemind(r) {
  if (!r || typeof r !== 'object' || !isISO(r.date) || !isHM(r.time)) return null;
  return { date: r.date, time: r.time, fired: !!r.fired, ack: !!r.ack, snooze: num(r.snooze), firedAt: num(r.firedAt) };
}
function remindMs(r) { const [h, m] = r.time.split(':').map(Number); const d = fromISO(r.date); d.setHours(h, m, 0, 0); return d.getTime(); }
/* Nouveau rappel planifié ; s'il est déjà passé, il est considéré comme traité (on ne sonne pas pour le passé). */
function makeRemind(date, time) {
  const r = { date, time, fired: false, ack: false, snooze: null, firedAt: null };
  if (remindMs(r) <= Date.now()) { r.fired = true; r.ack = true; }
  return r;
}
/* Prochain déclenchement prévu (ms) ou null. */
function remindNext(t) {
  if (!t.remind || t.done) return null;
  if (t.remind.snooze) return t.remind.snooze;
  return t.remind.fired ? null : remindMs(t.remind);
}
const remindRinging = (t) => !!(t.remind && !t.done && t.remind.fired && !t.remind.ack && !t.remind.snooze);
function fmtWhen(ms) {
  const d = new Date(ms), iso = toISO(d), today = todayISO();
  const hm = F_TIME.format(d);
  if (iso === today) return hm;
  if (iso === addDays(today, 1)) return `demain ${hm}`;
  return `${shortDate(iso)} ${hm}`;
}
function fmtWhenLong(ms) {
  const d = new Date(ms), iso = toISO(d), today = todayISO();
  const hm = F_TIME.format(d);
  if (iso === today) return `aujourd'hui à ${hm}`;
  if (iso === addDays(today, 1)) return `demain à ${hm}`;
  return `le ${longDate(iso)} à ${hm}`;
}
/* « 09:00 » → « 9 h », « 14:30 » → « 14 h 30 » */
function hLabel(hm) { const [h, m] = hm.split(':'); return m === '00' ? `${+h} h` : `${+h} h ${m}`; }
function offsetPhrase(days, time) {
  const at = hLabel(time);
  if (days === 0) return `le jour même à ${at}`;
  if (days === -1) return `la veille à ${at}`;
  if (days < 0) return `${-days} jours avant à ${at}`;
  if (days === 1) return `le lendemain à ${at}`;
  return `${days} jours après à ${at}`;
}
/* Décaler l'échéance en gardant l'écart avec le rappel (« le rappel suit la tâche »). */
function shiftDue(t, v) {
  const old = t.due;
  t.due = v;
  if (t.remind && old && v && old !== v) t.remind = makeRemind(addDays(t.remind.date, diffDays(v, old)), t.remind.time);
}

/* ---------- Matrice urgent / important ----------
   matrix = { important: true | false | null, urgent: true | false | null }
   important null : pas encore classée. urgent null : automatique, selon l'échéance. */
const triBool = (v) => (v === true || v === false ? v : null);
function normMatrix(m) {
  if (!m || typeof m !== 'object') return { important: null, urgent: null };
  return { important: triBool(m.important), urgent: triBool(m.urgent) };
}
function autoUrgent(t) {
  if (remindRinging(t)) return true;
  return !!(t.due && diffDays(t.due, todayISO()) <= state.settings.urgentDays);
}
const isUrgent = (t) => (t.matrix.urgent !== null ? t.matrix.urgent : autoUrgent(t));
/* q1 urgent et important, q2 important, q3 urgent, q4 ni l'un ni l'autre, inbox à classer */
function quadrantOf(t) {
  if (t.matrix.important === null) return 'inbox';
  const u = isUrgent(t);
  if (t.matrix.important) return u ? 'q1' : 'q2';
  return u ? 'q3' : 'q4';
}
const QUADS = {
  q1: { title: 'Urgent et important', sub: 'À faire maintenant', important: true, urgent: true },
  q2: { title: 'Important, pas urgent', sub: 'À planifier', important: true, urgent: false },
  q3: { title: 'Urgent, pas important', sub: 'À expédier ou déléguer', important: false, urgent: true },
  q4: { title: 'Ni urgent ni important', sub: 'Plus tard, ou à abandonner', important: false, urgent: false },
};
/* Place une tâche dans un cadran. Si l'urgence voulue correspond à l'automatique, on garde l'automatique :
   une tâche « à planifier » deviendra urgente d'elle-même quand son échéance approchera. */
function setQuadrant(t, q) {
  if (q === 'inbox') { t.matrix = { important: null, urgent: null }; return; }
  const want = QUADS[q];
  t.matrix = { important: want.important, urgent: want.urgent === autoUrgent(t) ? null : want.urgent };
}
const matrixActive = () => ui.view === 'matrix' && !ui.query.trim();
const overlayMode = () => isNarrow() || matrixActive();

/* Date de modification : jamais antérieure à la précédente, même si l'horloge de l'appareil retarde. */
function touch(t) { t.updatedAt = Math.max(Date.now(), (t.updatedAt || 0) + 1); return t.updatedAt; }

/* ---------- État ---------- */
let state = { tasks: [], settings: { ...DEFAULT_SETTINGS }, savedAt: 0, deleted: {} };
const ui = {
  view: 'todo',
  selectedId: null,
  lastIndex: 0,
  query: '',
  undo: [],
  redo: [],
  coalesceKey: null,
  storageOk: true,
  pendingComplete: new Map(),
  justDragged: false,
};

function normTask(t) {
  if (!t || typeof t !== 'object') return null;
  const now = Date.now();
  const done = !!t.done;
  return {
    id: validId(t.id) ? t.id : uid(),
    title: str(t.title).slice(0, 500),
    notes: str(t.notes).slice(0, 100000),
    steps: Array.isArray(t.steps)
      ? t.steps.filter((s) => s && typeof s === 'object').slice(0, 500).map((s) => ({ id: validId(s.id) ? s.id : uid(), text: str(s.text).slice(0, 1000), done: !!s.done }))
      : [],
    done,
    doneAt: done ? (num(t.doneAt) ?? now) : null,
    position: num(t.position) ?? 0,
    due: isISO(t.due) ? t.due : null,
    repeat: normRepeat(t.repeat),
    createdAt: num(t.createdAt) ?? now,
    updatedAt: num(t.updatedAt) ?? now,
    spawnedId: validId(t.spawnedId) ? t.spawnedId : null,
    seriesId: validId(t.seriesId) ? t.seriesId : null,
    remind: normRemind(t.remind),
    matrix: normMatrix(t.matrix),
  };
}
function normData(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.tasks)) return null;
  const seen = new Set();
  const tasks = [];
  for (const raw of d.tasks) {
    const t = normTask(raw);
    if (!t) continue;
    if (seen.has(t.id)) t.id = uid();
    seen.add(t.id);
    tasks.push(t);
  }
  const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const settings = { ...DEFAULT_SETTINGS };
  if (['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
  if (['top', 'bottom'].includes(s.addTo)) settings.addTo = s.addTo;
  if (typeof s.holidays === 'boolean') settings.holidays = s.holidays;
  if (typeof s.doneTodayOpen === 'boolean') settings.doneTodayOpen = s.doneTodayOpen;
  if (isHM(s.remindTime)) settings.remindTime = s.remindTime;
  if ([0, 1, 2, 3, 5, 7].includes(s.urgentDays)) settings.urgentDays = s.urgentDays;
  if (typeof s.remindSound === 'boolean') settings.remindSound = s.remindSound;
  if (typeof s.remindSticky === 'boolean') settings.remindSticky = s.remindSticky;
  // suppressions récentes (60 jours), pour qu'une fusion ne fasse pas réapparaître une tâche supprimée
  const deleted = {};
  const limit = Date.now() - 60 * 86400000;
  if (d.deleted && typeof d.deleted === 'object') {
    for (const [id, at] of Object.entries(d.deleted)) if (validId(id) && typeof at === 'number' && at > limit && !seen.has(id)) deleted[id] = at;
  }
  return { tasks, settings, savedAt: num(d.savedAt) ?? 0, deleted, settingsAt: num(d.settingsAt) ?? 0 };
}
function serialize(data = state) {
  return JSON.stringify({ app: APP, schema: SCHEMA, version: VERSION, savedAt: data.savedAt, settings: data.settings, settingsAt: data.settingsAt || 0, tasks: data.tasks, deleted: data.deleted || {} }, null, 2);
}

const byId = (id) => state.tasks.find((t) => t.id === id) || null;
const cmpPos = (a, b) => a.position - b.position || a.createdAt - b.createdAt;
const openSorted = () => state.tasks.filter((t) => !t.done).sort(cmpPos);
const doneSorted = () => state.tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
const isDueNow = (t) => !t.done && t.due && t.due <= todayISO();
const inToday = (t) => {
  if (t.done) return false;
  if (t.due && t.due <= todayISO()) return true;
  if (remindRinging(t)) return true;
  const n = remindNext(t);
  return n !== null && toISO(new Date(n)) === todayISO();
};

/* ---------- Stockage local ---------- */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { ui.storageOk = false; return null; } }
function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) {
    ui.storageOk = false;
    console.warn('Stockage local indisponible', e);
    return false;
  }
}
function loadLocal() {
  const raw = lsGet(KEY_DATA);
  if (!raw) return null;
  try {
    const d = normData(JSON.parse(raw));
    if (d) return d;
  } catch (e) { /* données illisibles */ }
  lsSet(`${KEY_BACKUP}.illisible.${Date.now()}`, raw);
  setTimeout(() => toast('Les données du navigateur étaient illisibles. Une copie brute a été conservée ; restaurez un point de restauration ou importez une sauvegarde.', { duration: 12000 }), 300);
  return null;
}
function saveLocal() {
  const text = serializeCompact();
  let ok = lsSet(KEY_DATA, text);
  if (!ok) { // quota plein : on sacrifie les points de restauration les plus anciens
    let snaps = readSnaps();
    while (!ok && snaps.length) {
      snaps = snaps.slice(0, -1);
      if (snaps.length) lsSet(KEY_SNAPS, JSON.stringify(snaps));
      else { try { localStorage.removeItem(KEY_SNAPS); } catch (e) { /* ignore */ } }
      ok = lsSet(KEY_DATA, text);
    }
    lastSnapDay = null;
  }
  if (ok) ui.storageOk = true;
  return ok;
}
function serializeCompact() {
  return JSON.stringify({ app: APP, schema: SCHEMA, version: VERSION, savedAt: state.savedAt, settings: state.settings, settingsAt: state.settingsAt || 0, tasks: state.tasks, deleted: state.deleted });
}
let lastSnapDay = null;
function readSnaps() { try { const a = JSON.parse(lsGet(KEY_SNAPS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function snapshotDaily(force = false) {
  if (!state.tasks.length && !force) return;
  const day = todayISO();
  if (!force && lastSnapDay === day) return;
  const snaps = readSnaps();
  lastSnapDay = snaps[0] ? snaps[0].day : null;
  if (snaps[0] && snaps[0].day === day && !force) return;
  const entry = { day, at: Date.now(), tasks: state.tasks };
  if (snaps[0] && snaps[0].day === day) snaps[0] = entry; else snaps.unshift(entry);
  if (lsSet(KEY_SNAPS, JSON.stringify(snaps.slice(0, MAX_SNAPS)))) lastSnapDay = day;
}

/* ---------- Modifications, annulation ---------- */
function pruneDeleted() {
  for (const t of state.tasks) if (state.deleted[t.id]) delete state.deleted[t.id];
}
function persist() {
  pruneDeleted();
  state.savedAt = Math.max(Date.now(), state.savedAt + 1);
  saveLocal();
  snapshotDaily();
  fileSync.schedule();
  if (typeof cloud !== 'undefined') cloud.schedule();
}
/* Toute modification des tâches passe par ici. */
function commit(mutator, opts = {}) {
  const before = JSON.stringify(state.tasks);
  if (mutator() === false) return false;
  const after = JSON.stringify(state.tasks);
  if (after === before) return false;
  if (opts.undo !== false) {
    const same = opts.coalesce && ui.coalesceKey === opts.coalesce;
    if (!same) {
      ui.undo.push({ tasks: before, label: opts.undo || 'Modification', sel: ui.selectedId });
      if (ui.undo.length > MAX_UNDO) ui.undo.shift();
    }
    ui.redo = [];
    ui.coalesceKey = opts.coalesce || null;
  }
  persist();
  if (opts.light && !ui.query.trim()) { renderHeader(); opts.light(); renderStatus(); }
  else render({ detail: opts.detail !== false });
  return true;
}
function cancelPendingCompletes() {
  if (!ui.pendingComplete.size) return false;
  for (const [id, timer] of ui.pendingComplete) {
    clearTimeout(timer);
    const r = rowEl(id);
    if (r) { r.classList.remove('completing', 'leaving'); const cb = r.querySelector('input[type="checkbox"]'); if (cb) cb.checked = false; }
  }
  ui.pendingComplete.clear();
  return true;
}
/* Après une annulation, un rappel identique garde son état « déjà parti / traité ». */
function keepRemindRuntime(next, current) {
  const cur = new Map(current.map((t) => [t.id, t.remind]));
  for (const t of next) {
    const c = cur.get(t.id);
    if (!t.remind) continue;
    if (c && c.date === t.remind.date && c.time === t.remind.time) {
      Object.assign(t.remind, { fired: c.fired, ack: c.ack, snooze: c.snooze, firedAt: c.firedAt });
    } else if (!t.remind.fired && remindMs(t.remind) < Date.now() - 60000) {
      Object.assign(t.remind, { fired: true, ack: true, snooze: null }); // on ne fait pas sonner un rappel ressuscité du passé
    }
  }
  return next;
}
/* Après un remplacement en bloc (annuler, rétablir, importer, restaurer) : les tâches modifiées reçoivent
   une nouvelle date de modification et les tâches disparues une marque de suppression, pour que les autres
   appareils et le fichier de sauvegarde suivent au lieu de rétablir l'ancienne version. */
function stampDiff(prev, next) {
  const now = Date.now();
  const before = new Map(prev.map((t) => [t.id, t]));
  const ids = new Set();
  for (const t of next) {
    ids.add(t.id);
    const p = before.get(t.id);
    if (!p || JSON.stringify(p) !== JSON.stringify(t)) t.updatedAt = Math.max(now, (p ? p.updatedAt : 0) + 1);
  }
  for (const p of prev) if (!ids.has(p.id)) state.deleted[p.id] = now;
}
function undo() {
  if (cancelPendingCompletes()) return;
  const e = ui.undo.pop();
  if (!e) { toast('Rien à annuler.'); return; }
  ui.redo.push({ tasks: JSON.stringify(state.tasks), label: e.label, sel: ui.selectedId });
  { const prev = state.tasks; state.tasks = keepRemindRuntime(JSON.parse(e.tasks), prev); stampDiff(prev, state.tasks); }
  ui.coalesceKey = null;
  if (e.sel && byId(e.sel)) ui.selectedId = e.sel;
  persist();
  render();
  reminders.refresh();
  toast(`Annulé : ${e.label.toLowerCase()}.`, { action: 'Rétablir', onAction: redo });
}
function redo() {
  const e = ui.redo.pop();
  if (!e) { toast('Rien à rétablir.'); return; }
  ui.undo.push({ tasks: JSON.stringify(state.tasks), label: e.label, sel: ui.selectedId });
  { const prev = state.tasks; state.tasks = keepRemindRuntime(JSON.parse(e.tasks), prev); stampDiff(prev, state.tasks); }
  ui.coalesceKey = null;
  if (e.sel && byId(e.sel)) ui.selectedId = e.sel;
  persist();
  render();
  reminders.refresh();
  toast(`Rétabli : ${e.label.toLowerCase()}.`);
}
function setSetting(key, value) {
  state.settings[key] = value;
  if (typeof SYNCED_SETTINGS !== 'undefined' && SYNCED_SETTINGS.includes(key)) state.settingsAt = Date.now();
  persist();
  if (key === 'theme') applyTheme();
  render();
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ---------- Opérations sur les tâches ---------- */
function renormalize() {
  state.tasks.slice().sort(cmpPos).forEach((t, i) => { t.position = i; });
}
/* Place `id` à l'index `target` dans l'ordre visible `order` (liste d'identifiants). */
function placeAt(order, id, target) {
  const rest = order.filter((x) => x !== id);
  target = Math.max(0, Math.min(rest.length, target));
  const t = byId(id);
  const prev = target > 0 ? byId(rest[target - 1]) : null;
  const next = target < rest.length ? byId(rest[target]) : null;
  let pos;
  if (prev && next) {
    if (!(next.position - prev.position > 1e-7)) { renormalize(); return placeAt(order, id, target); }
    pos = (prev.position + next.position) / 2;
  } else if (prev) pos = prev.position + 1;
  else if (next) pos = next.position - 1;
  else pos = t.position;
  t.position = pos;
  touch(t);
}
function addTask(raw, where) {
  const { title, due, remind } = parseQuick(nfc(raw));
  if (!title) return null;
  const open = openSorted();
  const position = where === 'top' ? (open.length ? open[0].position - 1 : 0) : (open.length ? open[open.length - 1].position + 1 : 0);
  const now = Date.now();
  const t = normTask({ id: uid(), title, due, position, createdAt: now, updatedAt: now });
  if (remind) { t.remind = makeRemind(remind.date, remind.time); reminders.askPermission(); }
  commit(() => { state.tasks.push(t); }, { undo: 'Ajout de tâche', detail: false });
  return t;
}
/* Date de l'occurrence créée quand on coche la tâche aujourd'hui (rattrape les retards). */
function nextAfterCompletion(t) {
  const today = todayISO();
  let next = nextOccurrence(t.repeat, t.due || today);
  for (let i = 0; i < 400 && (t.repeat.type === 'workday' ? next <= today : next < today); i++) next = nextOccurrence(t.repeat, next);
  return next;
}
function completeTask(t) {
  const now = Date.now();
  t.done = true; t.doneAt = now; touch(t);
  if (t.remind) { t.remind.ack = true; t.remind.snooze = null; }
  if (!t.repeat) return null;
  const next = nextAfterCompletion(t);
  const nextId = `${(t.seriesId || t.id).slice(0, 60)}:${next}`;
  if (byId(nextId)) { t.spawnedId = nextId; return byId(nextId); }
  const clone = normTask({
    ...JSON.parse(JSON.stringify(t)),
    id: nextId, done: false, doneAt: null, due: next,
    steps: t.steps.map((s) => ({ id: uid(), text: s.text, done: false })),
    createdAt: now, updatedAt: now, spawnedId: null,
    seriesId: t.seriesId || t.id,
    remind: null,
    matrix: { important: t.matrix.important, urgent: null },
  });
  if (t.remind) {
    const off = t.due ? diffDays(t.remind.date, t.due) : 0;
    clone.remind = makeRemind(addDays(next, off), t.remind.time);
  }
  clone.position = t.position;
  state.tasks.push(clone);
  t.spawnedId = clone.id;
  return clone;
}
function reopenTask(t) {
  t.done = false; t.doneAt = null; touch(t);
  if (t.spawnedId) {
    const s = byId(t.spawnedId);
    if (s && !s.done && s.createdAt === s.updatedAt) { state.tasks = state.tasks.filter((x) => x.id !== s.id); state.deleted[s.id] = Date.now(); }
    else if (s) t.repeat = null; // une autre occurrence existe déjà : on évite deux séries parallèles
    t.spawnedId = null;
  }
}
function setDone(id, done, { advance = false } = {}) {
  setTimeout(() => reminders.refresh(), 0);
  const t = byId(id);
  if (!t || t.done === done) return;
  const nav = navOrder();
  const idx = nav.indexOf(id);
  let spawned = null;
  commit(() => { if (done) spawned = completeTask(t); else reopenTask(t); }, { undo: done ? 'Tâche terminée' : 'Tâche rouverte' });
  if (advance && done && ui.selectedId === id) {
    const after = navOrder();
    if (!after.includes(id)) selectIndex(Math.min(idx, after.length - 1), { quiet: true });
  }
  if (done) {
    const msg = spawned ? `Terminée. Prochaine occurrence : ${shortDate(spawned.due)}.` : 'Tâche terminée.';
    toast(msg, { action: 'Annuler', onAction: undo });
  }
}
function deleteTask(id) {
  setTimeout(() => reminders.refresh(), 0);
  const t = byId(id);
  if (!t) return;
  const nav = navOrder();
  const idx = nav.indexOf(id);
  commit(() => { state.tasks = state.tasks.filter((x) => x.id !== id); state.deleted[id] = Date.now(); }, { undo: 'Suppression' });
  if (ui.selectedId === id) {
    const after = navOrder();
    ui.selectedId = null;
    if (after.length) selectIndex(Math.min(Math.max(idx, 0), after.length - 1), { quiet: true });
    else render();
  }
  toast(`« ${truncate(t.title || 'Sans titre', 48)} » supprimée.`, { action: 'Annuler', onAction: undo });
}
function truncate(s, n) { return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; }

/* ---------- Saisie rapide : « @demain », « @ven », « @25/10 » ---------- */
const WEEKDAYS = { dim: 0, dimanche: 0, lun: 1, lundi: 1, mar: 2, mardi: 2, mer: 3, mercredi: 3, jeu: 4, jeudi: 4, ven: 5, vendredi: 5, sam: 6, samedi: 6 };
function resolveToken(tok) {
  const k = fold(tok).replace(/[’']/g, '').replace(/[.,;:!?)]+$/, '');
  const t = todayISO();
  if (['auj', 'aujourdhui', 'ajd', 'today'].includes(k)) return t;
  if (k === 'demain') return addDays(t, 1);
  if (k === 'apres-demain' || k === 'apresdemain') return addDays(t, 2);
  if (k === 'sem-pro' || k === 'semaine-pro' || k === 'semaine-prochaine') return addDays(weekStart(t), 7);
  if (k in WEEKDAYS) {
    let delta = (WEEKDAYS[k] - fromISO(t).getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(t, delta);
  }
  const m = k.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    let iso = `${y}-${pad(mo)}-${pad(d)}`;
    if (!isISO(iso)) return null;
    if (!m[3] && iso < t) { iso = `${y + 1}-${pad(mo)}-${pad(d)}`; if (!isISO(iso)) return null; }
    return iso;
  }
  return null;
}
function resolveTime(tok) {
  const m = fold(tok).replace(/[.,;:!?)]+$/, '').match(/^(\d{1,2})(?:h(\d{2})?|:(\d{2}))$/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || m[3] || 0);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}
function parseQuick(raw) {
  let due = null, time = null;
  const parts = [];
  for (const piece of String(raw).split(/(\s+)/)) {
    if (piece.startsWith('@') && piece.length > 1) {
      const d = resolveToken(piece.slice(1));
      if (d) { due = d; continue; }
      const tm = resolveTime(piece.slice(1));
      if (tm) { time = tm; continue; }
    }
    parts.push(piece);
  }
  let remind = null;
  if (time) {
    let date = due || todayISO();
    if (!due && remindMs({ date, time }) <= Date.now()) date = addDays(date, 1);
    remind = { date, time };
  }
  return { title: parts.join('').replace(/\s+/g, ' ').trim(), due, remind };
}

/* ---------- Vues ---------- */
function matches(t, q) {
  const f = fold(q);
  if (fold(t.title).includes(f)) return 'title';
  if (fold(t.notes).includes(f)) return 'notes';
  if (t.steps.some((s) => fold(s.text).includes(f))) return 'steps';
  return null;
}
function buildSections() {
  const q = ui.query.trim();
  if (q) {
    const open = openSorted().filter((t) => matches(t, q));
    const done = doneSorted().filter((t) => matches(t, q));
    const out = [];
    if (open.length) out.push({ id: 'search-open', head: { title: 'À faire', n: open.length }, items: open });
    if (done.length) out.push({ id: 'search-done', head: { title: 'Terminées', n: done.length }, items: done });
    return out;
  }
  if (ui.view === 'todo') {
    const out = [{ id: 'open', items: openSorted(), ranked: true, sortable: true }];
    const today = todayISO();
    const doneToday = doneSorted().filter((t) => dayOfMs(t.doneAt) === today);
    if (doneToday.length) {
      out.push({ id: 'doneToday', head: { title: "Terminées aujourd'hui", n: doneToday.length, toggle: true }, collapsed: !state.settings.doneTodayOpen, items: doneToday });
    }
    return out;
  }
  if (ui.view === 'today') {
    return [{ id: 'today', items: openSorted().filter(inToday), ranked: true, sortable: true }];
  }
  if (ui.view === 'matrix') {
    const open = openSorted();
    return ['inbox', 'q1', 'q2', 'q3', 'q4'].map((q) => ({ id: q, items: open.filter((t) => quadrantOf(t) === q) }));
  }
  // Terminées, par semaine
  const groups = new Map();
  for (const t of doneSorted()) {
    const ws = weekStart(dayOfMs(t.doneAt));
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push(t);
  }
  const thisWeek = weekStart(todayISO());
  const lastWeek = addDays(thisWeek, -7);
  return Array.from(groups, ([ws, items]) => {
    const we = addDays(ws, 6);
    const title = ws === thisWeek ? 'Cette semaine' : ws === lastWeek ? 'Semaine dernière' : `Semaine ${isoWeek(ws)}`;
    return { id: `w-${ws}`, week: ws, head: { title, sub: rangeLabel(ws, we), n: items.length, recap: ws }, items };
  });
}
function rangeLabel(a, b) {
  const da = fromISO(a), db = fromISO(b);
  const sameMonth = da.getMonth() === db.getMonth();
  const left = sameMonth ? String(da.getDate()) : F_DMONTH.format(da);
  const right = db.getFullYear() === new Date().getFullYear() ? F_DMONTH.format(db) : F_FULL.format(db);
  return `du ${left} au ${right}`;
}
function navOrder(sections = buildSections()) {
  const ids = [];
  for (const s of sections) if (!s.collapsed) for (const t of s.items) ids.push(t.id);
  return ids;
}

/* ---------- Rendu ---------- */
const els = {};
function render(opts = {}) {
  renderHeader();
  if (typeof pwa !== 'undefined' && els.status) pwa.render();
  const m = matrixActive();
  els.app.classList.toggle('matrixMode', m);
  els.matrix.hidden = !m;
  els.scroll.hidden = m;
  if (m) { els.list.innerHTML = ''; renderMatrix(); } else { els.matrix.innerHTML = ''; renderList(); }
  if (!overlayMode() && els.app.classList.contains('detailOpen')) closeOverlay({ quiet: true });
  if (opts.detail !== false) renderDetail();
  renderStatus();
}
function renderHeader() {
  const today = todayISO();
  const d = fromISO(today);
  els.todayLabel.textContent = `${F_LONG.format(d)}, semaine ${isoWeek(today)}`;
  const open = state.tasks.filter((t) => !t.done);
  const dueNow = open.filter(inToday);
  const late = dueNow.some((t) => t.due < today);
  els.countTodo.textContent = open.length || '';
  els.countToday.textContent = dueNow.length || '';
  els.countToday.className = `count${dueNow.length ? (late ? ' late' : ' hot') : ''}`;
  els.countToday.title = late ? 'Certaines échéances sont dépassées' : '';
  const q1 = open.filter((t) => quadrantOf(t) === 'q1').length;
  els.countMatrix.textContent = q1 || '';
  els.countMatrix.className = `count${q1 ? ' hot' : ''}`;
  els.countMatrix.title = q1 ? `${plural(q1, 'tâche urgente et importante', 'tâches urgentes et importantes')}` : '';
  for (const b of $$('.views [role="tab"]')) {
    const on = !ui.query.trim() && b.dataset.view === ui.view;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on || (ui.query.trim() && b.dataset.view === 'todo') ? 0 : -1;
  }
  document.title = dueNow.length ? `(${dueNow.length}) ${APP_NAME}` : APP_NAME;
  els.search.closest('.search').classList.toggle('has', !!ui.query);
}

function highlight(text, q) {
  const fq = fold(q);
  if (!fq) return esc(text);
  const { f, start, end } = foldMap(text);
  let out = '', last = 0, from = 0, j;
  while ((j = f.indexOf(fq, from)) !== -1) {
    const a = start[j], b = end[j + fq.length - 1];
    if (a >= last) { out += esc(text.slice(last, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; last = b; }
    from = j + fq.length;
  }
  return out + esc(text.slice(last));
}
function snippetFor(t, q, where) {
  let src = '';
  if (where === 'notes') src = t.notes.replace(/\s+/g, ' ');
  else if (where === 'steps') src = (t.steps.find((s) => fold(s.text).includes(fold(q))) || {}).text || '';
  const fm = foldMap(src);
  const fat = fm.f.indexOf(fold(q));
  if (fat < 0) return '';
  const at = fm.start[fat];
  const start = Math.max(0, at - 30);
  const piece = (start > 0 ? '…' : '') + src.slice(start, at + q.length + 60);
  return `<div class="snippet">${where === 'steps' ? 'Étape : ' : ''}${highlight(piece, q)}</div>`;
}
function rowHTML(t, i, sec) {
  const q = ui.query.trim();
  const cls = ['row'];
  if (t.done) cls.push('done');
  if (t.id === ui.selectedId) cls.push('sel');
  if (sec.ranked && i < 3) cls.push('top');
  if (sec.ranked && i === 0) cls.push('first');
  const rank = sec.ranked
    ? `<span class="rank" aria-hidden="true"><span class="num">${i + 1}</span>${icon('grip', 'ic grip')}</span>`
    : '<span class="rank" aria-hidden="true"></span>';
  const title = t.title ? highlight(t.title, q) : '<span class="untitled">Sans titre</span>';
  const where = q ? matches(t, q) : null;
  const snip = where && where !== 'title' ? snippetFor(t, q, where) : '';

  const meta = [];
  if (t.done) {
    meta.push(`<span class="chip" title="Terminée le ${esc(longDate(dayOfMs(t.doneAt)))} à ${F_TIME.format(new Date(t.doneAt))}">${esc(shortDate(dayOfMs(t.doneAt)))}</span>`);
  } else {
    if (t.steps.length) {
      const n = t.steps.filter((s) => s.done).length;
      const all = n === t.steps.length;
      meta.push(`<span class="chip${all ? ' ok' : ''}" title="${n} étape${n > 1 ? 's' : ''} faite${n > 1 ? 's' : ''} sur ${t.steps.length}">${icon('steps')}${n}/${t.steps.length}</span>`);
    }
    if (t.due) {
      const d = dueInfo(t.due);
      meta.push(`<span class="chip ${d.cls}" title="${esc(d.title)}">${t.repeat ? icon('repeat') : ''}${esc(d.text)}</span>`);
    } else if (t.repeat) {
      meta.push(`<span class="mini" title="${esc(repeatSentence(t.repeat))}">${icon('repeat')}</span>`);
    }
    if (remindRinging(t)) meta.push(`<span class="chip ring" title="Rappel en attente">${icon('bell')}Rappel</span>`);
    else {
      const nx = remindNext(t);
      if (nx) meta.push(`<span class="chip rem" title="Rappel ${esc(fmtWhenLong(nx))}">${icon('bell')}${esc(fmtWhen(nx))}</span>`);
    }
    if (t.notes.trim()) meta.push(`<span class="mini" title="Contient des notes">${icon('note')}</span>`);
  }
  const label = `${t.done ? 'Rouvrir' : 'Terminer'} : ${t.title || 'Sans titre'}`;
  return `<div class="${cls.join(' ')}" role="listitem" data-id="${esc(t.id)}" id="row-${esc(t.id)}"${t.id === ui.selectedId ? ' aria-current="true"' : ''}>`
    + rank
    + `<label class="check"><input type="checkbox"${t.done ? ' checked' : ''} aria-label="${esc(label)}" tabindex="-1"><span class="box"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span></label>`
    + `<div class="tcell"><div class="title">${title}</div>${snip}</div>`
    + `<span class="meta">${meta.join('')}</span>`
    + '</div>';
}
function sectionHeadHTML(sec) {
  const h = sec.head;
  if (!h) return '';
  const n = `<span class="n">${h.n}</span>`;
  if (h.toggle) {
    return `<button type="button" class="secHead" data-toggle="${sec.id}" aria-expanded="${!sec.collapsed}">${icon('chev', 'ic chev')}<span>${esc(h.title)}</span>${n}<span class="grow"></span></button>`;
  }
  const recap = h.recap ? `<button type="button" class="linkBtn" data-recap="${h.recap}" title="Copier la liste de la semaine, pour un mail ou Teams">${icon('copy')}Copier le récap</button>` : '';
  return `<div class="secHead"><span>${esc(h.title)}</span>${h.sub ? `<span class="sub">${esc(h.sub)}</span>` : ''}${n}<span class="grow"></span>${recap}</div>`;
}
function emptyHTML() {
  const q = ui.query.trim();
  if (q) return `<div class="empty"><h2>Aucun résultat</h2><p>Aucune tâche ne contient « ${esc(q)} », ni dans son titre, ni dans ses notes, ni dans ses étapes.</p></div>`;
  if (ui.view === 'todo') {
    if (!state.tasks.length) {
      const restore = fileSync.supported && !fileSync.handle && !setupCardWanted()
        ? '<p>Vous aviez déjà un fichier de sauvegarde ? <button type="button" class="linkBtn" data-act="open-file">Ouvrir le fichier de sauvegarde</button></p>' : '';
      return `<div class="empty"><h2>Votre liste est vide</h2><p>Tapez une tâche dans le champ ci-dessus, puis Entrée. La tâche du haut est la plus prioritaire : glissez les tâches pour changer l'ordre.</p><p>Ajoutez <code>@demain</code> ou <code>@ven</code> pour fixer une échéance.</p>${restore}</div>`;
    }
    return '<div class="empty"><h2>Tout est fait</h2><p>Les tâches terminées restent consultables dans l\'onglet Terminées.</p></div>';
  }
  if (ui.view === 'today') return '<div class="empty"><h2>Rien pour aujourd\'hui</h2><p>Les tâches dont l\'échéance tombe aujourd\'hui ou est dépassée, et celles qui ont un rappel aujourd\'hui, apparaissent ici, dans l\'ordre de priorité.</p></div>';
  return '<div class="empty"><h2>Aucune tâche terminée</h2><p>Chaque tâche cochée arrive ici, classée par semaine, avec un récapitulatif à copier pour votre point hebdomadaire.</p></div>';
}
function renderList() {
  const sections = buildSections();
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  let html = '';
  const first = sections[0];
  if (!total || (first && first.ranked && !first.items.length)) html = emptyHTML();
  for (const s of sections) {
    if (!s.items.length) continue;
    html += `<div class="section${s.sortable ? ' sortable' : ''}" data-section="${s.id}" role="group"${s.head ? ` aria-label="${esc(s.head.title)}"` : ''}>`;
    html += sectionHeadHTML(s);
    if (!s.collapsed) html += s.items.map((t, i) => rowHTML(t, i, s)).join('');
    html += '</div>';
  }
  els.list.innerHTML = html;
  const ids = navOrder(sections);
  const i = ids.indexOf(ui.selectedId);
  if (i >= 0) ui.lastIndex = i;
}
function markSelection() {
  for (const r of [...$$('.row', els.list), ...$$('.mcard', els.matrix)]) {
    const on = r.dataset.id === ui.selectedId;
    r.classList.toggle('sel', on);
    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  }
}
function rowEl(id) {
  if (!id) return null;
  const sel = `[data-id="${CSS.escape(id)}"]`;
  return matrixActive() ? els.matrix.querySelector(`.mcard${sel}`) : els.list.querySelector(`.row${sel}`);
}

/* ---------- Sélection ---------- */
function select(id, { open = false, scroll = true } = {}) {
  ui.selectedId = id;
  ui.coalesceKey = null;
  const ids = navOrder();
  const i = ids.indexOf(id);
  if (i >= 0) ui.lastIndex = i;
  markSelection();
  renderDetail();
  if (scroll) { const r = rowEl(id); if (r) r.scrollIntoView({ block: 'nearest' }); }
  if (open && overlayMode()) openOverlay();
}
function selectIndex(i, opts = {}) {
  const ids = navOrder();
  if (!ids.length) { ui.selectedId = null; renderDetail(); return; }
  select(ids[Math.max(0, Math.min(ids.length - 1, i))], opts);
}
function moveSelection(delta) {
  const ids = navOrder();
  if (!ids.length) return;
  const cur = ids.indexOf(ui.selectedId);
  const base = cur >= 0 ? cur : (delta > 0 ? Math.min(ui.lastIndex, ids.length) - 1 : Math.min(ui.lastIndex, ids.length));
  selectIndex(base + delta);
}
function openOverlay() {
  if (els.app.classList.contains('detailOpen')) return;
  els.app.classList.add('detailOpen');
  els.scrim.hidden = !matrixActive() || isNarrow();
  setBackgroundInert(true);
  try { history.pushState({ odjDetail: true }, ''); } catch (e) { /* file:// peut refuser */ }
  // le focus passe dans le panneau (sauf s'il y est déjà, par exemple sur le titre)
  requestAnimationFrame(() => { if (!els.detail.contains(document.activeElement)) { const b = els.detail.querySelector('.dBack'); if (b) b.focus({ preventScroll: true }); } });
}
/* Pendant que le panneau est ouvert, le reste de l'application ne reçoit ni clic ni Tab. */
function setBackgroundInert(on) {
  for (const el of [$('.topbar'), $('.listPane')]) if (el) el.inert = on;
}
function closeOverlay({ fromPop = false, quiet = false } = {}) {
  if (!els.app.classList.contains('detailOpen')) { els.scrim.hidden = true; setBackgroundInert(false); return; }
  els.app.classList.remove('detailOpen');
  els.scrim.hidden = true;
  setBackgroundInert(false);
  if (!fromPop && history.state && history.state.odjDetail) { try { history.back(); } catch (e) { /* ignore */ } }
  if (quiet) return;
  const r = rowEl(ui.selectedId);
  if (r) r.scrollIntoView({ block: 'nearest' });
  focusSelectionHost();
}

/* =====================================================================
   Matrice urgent / important
   ===================================================================== */
function mcardHTML(t, i, q) {
  const meta = [];
  if (t.due) { const d = dueInfo(t.due); meta.push(`<span class="chip ${d.cls}" title="${esc(d.title)}">${t.repeat ? icon('repeat') : ''}${esc(d.text)}</span>`); }
  if (remindRinging(t)) meta.push(`<span class="chip ring">${icon('bell')}Rappel</span>`);
  else { const nx = remindNext(t); if (nx) meta.push(`<span class="chip rem" title="Rappel ${esc(fmtWhenLong(nx))}">${icon('bell')}${esc(fmtWhen(nx))}</span>`); }
  if (t.steps.length) { const n = t.steps.filter((s) => s.done).length; meta.push(`<span class="chip${n === t.steps.length ? ' ok' : ''}">${icon('steps')}${n}/${t.steps.length}</span>`); }
  if (t.matrix.urgent !== null && q !== 'inbox') meta.push(`<span class="chip forced" title="Urgence fixée à la main">${t.matrix.urgent ? 'Urgence forcée' : 'Non urgent forcé'}</span>`);
  const triage = q === 'inbox'
    ? `<span class="triage"><button type="button" class="pill" data-tri="true" title="Important (I)">Important</button><button type="button" class="pill" data-tri="false" title="Pas important">Pas important</button></span>`
    : '';
  return `<div class="mcard${t.id === ui.selectedId ? ' sel' : ''}" draggable="true" tabindex="-1" role="listitem" data-id="${esc(t.id)}"${t.id === ui.selectedId ? ' aria-current="true"' : ''}>
    <span class="mnum" aria-hidden="true">${i + 1}</span>
    <label class="check"><input type="checkbox" aria-label="${esc(`Terminer : ${t.title || 'Sans titre'}`)}" tabindex="-1"><span class="box"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span></label>
    <div class="mbody"><div class="mtitle">${t.title ? esc(t.title) : '<span class="untitled">Sans titre</span>'}</div>${meta.length ? `<div class="mmeta">${meta.join('')}</div>` : ''}${triage}</div>
  </div>`;
}
function quadHTML(q, items) {
  const Q = QUADS[q];
  const empty = {
    q1: 'Rien d\'urgent et important. Profitez-en pour avancer sur le cadran « à planifier ».',
    q2: 'Les tâches importantes sans urgence : planifiez-les avant qu\'elles ne deviennent urgentes.',
    q3: 'Les tâches urgentes mais peu importantes : faites-les vite, ou déléguez-les.',
    q4: 'Ni urgent ni important : à garder pour plus tard, ou à supprimer.',
  }[q];
  return `<section class="quad ${q}" data-drop="${q}" aria-labelledby="h-${q}">
    <header class="qhead"><h2 id="h-${q}">${esc(Q.title)}</h2><span class="qsub">${esc(Q.sub)}</span><span class="grow"></span><span class="qn">${items.length || ''}</span></header>
    <div class="qbody" role="list">${items.length ? items.map((t, i) => mcardHTML(t, i, q)).join('') : `<p class="qempty">${empty}</p>`}</div>
  </section>`;
}
function renderMatrix() {
  const open = openSorted();
  const by = { q1: [], q2: [], q3: [], q4: [], inbox: [] };
  for (const t of open) by[quadrantOf(t)].push(t);
  const hadFocus = els.matrix.contains(document.activeElement) || document.activeElement === document.body;
  const scrolls = {};
  for (const b of $$('[data-drop]', els.matrix)) { const body = b.querySelector('.qbody'); if (body) scrolls[b.dataset.drop] = body.scrollTop; }
  if (!open.length) {
    els.matrix.innerHTML = '<div class="empty"><h2>Aucune tâche à classer</h2><p>Ajoutez des tâches : elles arrivent dans « À classer », puis vous indiquez si elles sont importantes. L\'urgence se déduit de l\'échéance.</p></div>';
    els.matrix.classList.remove('hasInbox');
    return;
  }
  const inbox = by.inbox.length ? `<aside class="inbox" data-drop="inbox" aria-labelledby="h-inbox">
      <header class="qhead"><h2 id="h-inbox">À classer</h2><span class="grow"></span><span class="qn">${by.inbox.length}</span></header>
      <p class="ihint">Est-ce important ? Cliquez, ou glissez la tâche dans un cadran. L'urgence suit l'échéance.</p>
      <div class="qbody" role="list">${by.inbox.map((t, i) => mcardHTML(t, i, 'inbox')).join('')}</div>
    </aside>` : '';
  els.matrix.classList.toggle('hasInbox', !!by.inbox.length);
  els.matrix.innerHTML = `${inbox}<div class="grid4">
      <span class="axis ax-top ax-u">Urgent</span><span class="axis ax-top ax-nu">Pas urgent</span>
      <span class="axis ax-side ax-i">Important</span><span class="axis ax-side ax-ni">Pas important</span>
      ${quadHTML('q1', by.q1)}${quadHTML('q2', by.q2)}${quadHTML('q3', by.q3)}${quadHTML('q4', by.q4)}
    </div>`;
  for (const [k, v] of Object.entries(scrolls)) { const b = els.matrix.querySelector(`[data-drop="${k}"] .qbody`); if (b) b.scrollTop = v; }
  if (mdrag.id && !els.matrix.querySelector(`.mcard[data-id="${CSS.escape(mdrag.id)}"]`)) endMatrixDrag();
  if (hadFocus && !els.app.classList.contains('detailOpen') && !document.querySelector('dialog[open]')) {
    const r = rowEl(ui.selectedId);
    if (r) r.focus({ preventScroll: true });
  }
}
function endMatrixDrag() {
  mdrag.id = null;
  els.matrix.classList.remove('isDragging');
  for (const el of $$('.dragging, .dropBefore, .dropAfter, .dropOn', els.matrix)) el.classList.remove('dragging', 'dropBefore', 'dropAfter', 'dropOn');
}
function focusSelectionHost() {
  if (matrixActive()) { const r = rowEl(ui.selectedId); if (r) r.focus({ preventScroll: true }); }
  else els.list.focus({ preventScroll: true });
}
const mdrag = { id: null };
function bindMatrix() {
  const M = els.matrix;
  M.addEventListener('click', (e) => {
    const card = e.target.closest('.mcard');
    if (!card) return;
    const t = byId(card.dataset.id);
    if (!t) return;
    const tri = e.target.closest('[data-tri]');
    if (tri) {
      const v = tri.dataset.tri === 'true';
      commit(() => { t.matrix.important = v; touch(t); }, { undo: v ? 'Marquée importante' : 'Marquée pas importante' });
      const q = quadrantOf(t);
      const el = rowEl(t.id);
      if (el && !reducedMotion()) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
      toast(`Classée dans « ${QUADS[q].title} ».`, { action: 'Annuler', onAction: undo });
      return;
    }
    if (e.target.closest('.check')) return;
    select(t.id, { open: true, scroll: false });
  });
  M.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    const card = cb.closest('.mcard');
    if (card) toggleFromList(card.dataset.id, cb.checked, card);
  });
  M.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.mcard');
    if (!card) return;
    mdrag.id = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-todo-task', card.dataset.id);
    e.dataTransfer.setData('text/plain', (byId(card.dataset.id) || {}).title || '');
    requestAnimationFrame(() => card.classList.add('dragging'));
    M.classList.add('isDragging');
  });
  const clearMarks = () => {
    for (const el of $$('.dropBefore, .dropAfter, .dropOn', M)) el.classList.remove('dropBefore', 'dropAfter', 'dropOn');
  };
  const target = (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone) return null;
    let card = e.target.closest('.mcard');
    if (card && card.dataset.id === mdrag.id) card = null;
    let after = false;
    if (card) { const r = card.getBoundingClientRect(); after = e.clientY > r.top + r.height / 2; }
    return { zone, card, after };
  };
  M.addEventListener('dragover', (e) => {
    if (!mdrag.id) return;
    const tg = target(e);
    if (!tg) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    tg.zone.classList.add('dropOn');
    if (tg.card) tg.card.classList.add(tg.after ? 'dropAfter' : 'dropBefore');
  });
  M.addEventListener('dragleave', (e) => { if (!M.contains(e.relatedTarget)) clearMarks(); });
  M.addEventListener('drop', (e) => {
    if (!mdrag.id) return;
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('application/x-todo-task')) { endMatrixDrag(); return; }
    const tg = target(e);
    clearMarks();
    if (!tg) return;
    e.preventDefault();
    e.stopPropagation();
    const t = byId(mdrag.id);
    if (!t) return;
    const q = tg.zone.dataset.drop;
    const before = quadrantOf(t);
    commit(() => {
      if (before !== q) setQuadrant(t, q);
      if (tg.card) { // ordre : avant ou après la tâche visée, dans la liste complète
        const order = openSorted().map((x) => x.id);
        const rest = order.filter((x) => x !== t.id);
        const idx = rest.indexOf(tg.card.dataset.id) + (tg.after ? 1 : 0);
        placeAt(order, t.id, idx);
      }
      touch(t);
    }, { undo: before === q ? 'Changement de priorité' : 'Changement de cadran', detail: false });
    if (byId(ui.selectedId) && ui.selectedId === t.id) updateDetailBits(t);
    const el = rowEl(t.id);
    if (el && !reducedMotion()) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  });
  // sur document : si la carte d'origine a été redessinée pendant le glisser, l'événement ne remonte plus jusqu'à la matrice
  document.addEventListener('dragend', () => { if (mdrag.id) endMatrixDrag(); });
}

/* ---------- Déplacement dans la liste ---------- */
function sortableOrder() {
  if (ui.query.trim()) return null;
  const sec = buildSections().find((s) => s.sortable);
  return sec ? sec.items.map((t) => t.id) : null;
}
function moveTask(id, how) {
  const t0 = byId(id);
  if (!t0 || t0.done) return;
  const global = how === 'top' || how === 'bottom';
  const order = global ? openSorted().map((t) => t.id) : sortableOrder();
  if (!order) { toast(matrixActive() ? 'Dans la matrice, glissez la tâche au-dessus ou en dessous d\'une autre pour changer son rang.' : 'Le classement se modifie depuis les onglets À faire ou Aujourd\'hui, hors recherche.'); return; }
  const i = order.indexOf(id);
  if (i < 0) return;
  let target = i;
  if (how === 'up') target = i - 1;
  else if (how === 'down') target = i + 1;
  else if (how === 'top') target = 0;
  else if (how === 'bottom') target = order.length - 1;
  target = Math.max(0, Math.min(order.length - 1, target));
  if (target === i) return;
  commit(() => placeAt(order, id, target), { undo: 'Changement de priorité', coalesce: `move:${id}`, detail: false });
  const r = rowEl(id);
  if (r) r.scrollIntoView({ block: 'nearest' });
  if (how === 'top') toast('Tâche placée en tête de liste.');
}

/* ---------- Glisser-déposer (souris : toute la ligne ; tactile : le numéro) ---------- */
const drag = { active: false };
function onListPointerDown(e) {
  if (e.button !== 0) return;
  const row = e.target.closest('.row');
  if (!row || e.target.closest('.check, button, a, input')) return;
  const section = row.closest('.section');
  if (!section || !section.classList.contains('sortable') || ui.query.trim()) return;
  if (e.pointerType !== 'mouse' && !e.target.closest('.rank')) return;
  drag.pending = { row, section, id: row.dataset.id, startY: e.clientY, pointerId: e.pointerId };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
}
function beginDrag() {
  const p = drag.pending;
  const rows = $$('.row', p.section);
  drag.active = true;
  drag.id = p.id;
  drag.row = p.row;
  drag.rows = rows;
  drag.order = rows.map((r) => r.dataset.id);
  drag.from = drag.order.indexOf(p.id);
  drag.target = drag.from;
  drag.rects = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top, h: b.height, mid: b.top + b.height / 2 }; });
  drag.scroll0 = els.scroll.scrollTop;
  drag.startY = p.startY;
  drag.lastY = p.startY;
  drag.h = drag.rects[drag.from].h;
  p.row.classList.add('dragging');
  els.list.classList.add('isDragging');
  document.body.classList.add('dragging');
  try { p.row.setPointerCapture(p.pointerId); } catch (e) { /* ignore */ }
  drag.raf = requestAnimationFrame(autoScroll);
}
function onDragMove(e) {
  if (drag.pending && !drag.active) {
    if (Math.abs(e.clientY - drag.pending.startY) < 5) return;
    beginDrag();
  }
  if (!drag.active) return;
  e.preventDefault();
  drag.lastY = e.clientY;
  layoutDrag();
}
function layoutDrag() {
  const ds = els.scroll.scrollTop - drag.scroll0;
  const dy = drag.lastY - drag.startY + ds;
  drag.row.style.transform = `translateY(${dy}px)`;
  const y = drag.lastY + ds; // position dans le repère initial
  let target = 0;
  for (let i = 0; i < drag.rects.length; i++) {
    if (i === drag.from) continue;
    if (y > drag.rects[i].mid) target = i < drag.from ? i + 1 : i;
  }
  if (y < drag.rects[0].mid) target = 0;
  target = Math.max(0, Math.min(drag.rects.length - 1, target));
  drag.target = target;
  drag.rows.forEach((r, i) => {
    if (i === drag.from) return;
    let shift = 0;
    if (drag.from < target && i > drag.from && i <= target) shift = -drag.h;
    if (drag.from > target && i < drag.from && i >= target) shift = drag.h;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
function autoScroll() {
  if (!drag.active) return;
  const b = els.scroll.getBoundingClientRect();
  const edge = 48;
  let v = 0;
  if (drag.lastY < b.top + edge) v = -Math.ceil((b.top + edge - drag.lastY) / 4);
  else if (drag.lastY > b.bottom - edge) v = Math.ceil((drag.lastY - (b.bottom - edge)) / 4);
  if (v) { els.scroll.scrollTop += v; layoutDrag(); }
  drag.raf = requestAnimationFrame(autoScroll);
}
function cleanupDrag() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  cancelAnimationFrame(drag.raf);
  if (drag.rows) drag.rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
  els.list.classList.remove('isDragging');
  document.body.classList.remove('dragging');
}
function onDragEnd() {
  const wasActive = drag.active;
  const { id, from, target, order } = drag;
  cleanupDrag();
  drag.active = false; drag.pending = null;
  if (!wasActive) return;
  ui.justDragged = true;
  setTimeout(() => { ui.justDragged = false; }, 0);
  if (target !== from) {
    commit(() => placeAt(order, id, target), { undo: 'Changement de priorité', detail: false });
    const r = rowEl(id);
    if (r && !reducedMotion()) { r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1400); }
  } else renderList();
}
function onDragCancel() { cleanupDrag(); drag.active = false; drag.pending = null; renderList(); }

/* ---------- Panneau de détail ---------- */
function renderDetail() {
  const t = byId(ui.selectedId);
  const pane = els.detail;
  // mémoriser le focus pour le restaurer après rendu
  const ae = document.activeElement;
  const fk = ae && pane.contains(ae) ? ae.dataset.k : null;
  const sel = fk && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const scroll = pane.scrollTop;
  const sameTask = pane.dataset.id === (t ? t.id : '');

  if (!t) {
    pane.dataset.id = '';
    pane.innerHTML = `<div class="dEmpty"><h2>Aucune tâche sélectionnée</h2><p>Cliquez sur une tâche pour noter ce qu'il faut faire précisément : étapes, contacts, chemins de fichiers.</p>
      <dl><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Parcourir la liste</dd><dt><kbd>Entrée</kbd></dt><dd>Modifier la tâche sélectionnée</dd><dt><kbd>Espace</kbd></dt><dd>Terminer</dd><dt><kbd>?</kbd></dt><dd>Tous les raccourcis</dd></dl></div>`;
    if (overlayMode()) closeOverlay();
    return;
  }
  pane.dataset.id = t.id;
  const today = todayISO();
  const repType = t.repeat ? t.repeat.type : 'none';
  const opts = Object.entries(REPEAT_LABELS).map(([k, v]) => `<option value="${k}"${k === repType ? ' selected' : ''}>${v}</option>`).join('');
  pane.innerHTML = `<div class="detail${t.done ? ' isDone' : ''}">
    <div class="dHead">
      <button type="button" class="iconBtn dBack" data-act="back" aria-label="Revenir à la liste" title="Revenir à la liste (Échap)">${icon('back')}</button>
      <label class="dCheck"><span class="check"><input type="checkbox" data-k="done" id="dDone"${t.done ? ' checked' : ''}><span class="box"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span></span><span id="dDoneLabel"></span></label>
      <span class="grow"></span>
      <button type="button" class="iconBtn" data-act="top" data-k="top" title="Mettre en tête de liste (Alt+Maj+↑)" aria-label="Mettre en tête de liste"${t.done ? ' hidden' : ''}>${icon('top')}</button>
      <button type="button" class="iconBtn danger" data-act="delete" data-k="delete" title="Supprimer (Suppr)" aria-label="Supprimer la tâche">${icon('trash')}</button>
    </div>
    <textarea class="dTitle" id="dTitle" data-k="title" rows="1" maxlength="500" placeholder="Titre de la tâche" aria-label="Titre de la tâche">${esc(t.title)}</textarea>
    <div class="props">
      <span class="propLabel" id="lblDue">Échéance</span>
      <div class="propCtl" role="group" aria-labelledby="lblDue">
        <input type="date" class="field" id="dDue" data-k="due" value="${t.due || ''}" aria-label="Date d'échéance">
        <button type="button" class="pill" data-due="${today}" data-k="due-today">Aujourd'hui</button>
        <button type="button" class="pill" data-due="${addDays(today, 1)}" data-k="due-tomorrow">Demain</button>
        <button type="button" class="pill" data-due="${addDays(weekStart(today), 7)}" data-k="due-monday">Lundi prochain</button>
        <button type="button" class="pill" data-due="" data-k="due-none" id="dDueNone">Sans date</button>
        <p class="hint" id="dDueHint"></p>
      </div>
      <label class="propLabel" for="dRepeat">Répétition</label>
      <div class="propCtl">
        <select id="dRepeat" data-k="repeat">${opts}</select>
        <input type="number" class="field nth" id="dNth" data-k="nth" min="1" max="23" step="1" value="${t.repeat && t.repeat.type === 'nth' ? t.repeat.n : 3}" aria-label="Numéro du jour ouvré" title="Numéro du jour ouvré dans le mois">
        <p class="hint" id="dRepeatHint"></p>
      </div>
      <span class="propLabel" id="lblMx">Priorité</span>
      <div class="propCtl" role="group" aria-labelledby="lblMx">
        <span class="seg" role="group" aria-label="Importance">
          <button type="button" class="segBtn" data-imp="true" data-k="imp-yes">Important</button>
          <button type="button" class="segBtn" data-imp="false" data-k="imp-no">Pas important</button>
          <button type="button" class="segBtn" data-imp="null" data-k="imp-null">À classer</button>
        </span>
        <span class="seg" role="group" aria-label="Urgence">
          <button type="button" class="segBtn" data-urg="null" data-k="urg-auto">Auto</button>
          <button type="button" class="segBtn" data-urg="true" data-k="urg-yes">Urgent</button>
          <button type="button" class="segBtn" data-urg="false" data-k="urg-no">Pas urgent</button>
        </span>
        <p class="hint" id="dMxHint"></p>
      </div>
      <span class="propLabel" id="lblRem">Rappel</span>
      <div class="propCtl" role="group" aria-labelledby="lblRem">
        <input type="date" class="field" id="dRemDate" data-k="remdate" aria-label="Date du rappel">
        <input type="time" class="field" id="dRemTime" data-k="remtime" step="300" aria-label="Heure du rappel">
        <button type="button" class="pill" data-rem="1h" data-k="rem-1h">Dans 1 h</button>
        <button type="button" class="pill" data-rem="tomorrow" data-k="rem-tomorrow" id="dRemTomorrow"></button>
        <button type="button" class="pill" data-rem="dday" data-k="rem-dday" id="dRemDday"></button>
        <button type="button" class="pill" data-rem="eve" data-k="rem-eve">La veille à 17 h</button>
        <button type="button" class="pill" data-rem="none" data-k="rem-none" id="dRemNone">Aucun</button>
        <p class="hint" id="dRemHint"></p>
        <button type="button" class="linkBtn" data-act="ics" data-k="ics" id="dIcs" title="Télécharge un fichier à ouvrir avec Outlook : le rappel fonctionnera même Chrome fermé">${icon('cal')}Ajouter à Outlook</button>
      </div>
    </div>
    <section class="block" aria-labelledby="hSteps">
      <div class="blockHead"><h3 id="hSteps">Étapes</h3><span class="n" id="dStepsN"></span></div>
      <div class="bar" id="dBar"><i></i></div>
      <ol class="steps" id="dSteps"></ol>
      <div class="addStep">${icon('plus')}<input type="text" id="dAddStep" data-k="addstep" placeholder="Ajouter une étape" aria-label="Ajouter une étape" maxlength="300"></div>
    </section>
    <section class="block" aria-labelledby="hNotes">
      <div class="blockHead"><h3 id="hNotes">Notes</h3></div>
      <textarea class="notes" id="dNotes" data-k="notes" maxlength="100000" aria-labelledby="hNotes" placeholder="Contexte, interlocuteurs, chemins de fichiers, liens, ce qu'il ne faut pas oublier…">${esc(t.notes)}</textarea>
      <div class="links" id="dLinks"></div>
    </section>
    <footer class="dMeta" id="dMeta"></footer>
  </div>`;
  renderSteps(t);
  updateDetailBits(t);
  autosize($('#dTitle', pane));
  autosize($('#dNotes', pane));
  if (sameTask) pane.scrollTop = scroll; else pane.scrollTop = 0;
  if (fk) {
    const el = pane.querySelector(`[data-k="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* type sans sélection */ } }
    }
  }
}
function updateDetailBits(t) {
  const pane = els.detail;
  if (!t || pane.dataset.id !== t.id) return;
  const today = todayISO();
  const done = $('#dDone', pane);
  done.checked = t.done;
  $('#dDoneLabel', pane).textContent = t.done ? `Terminée ${dayOfMs(t.doneAt) === today ? "aujourd'hui" : 'le ' + shortDate(dayOfMs(t.doneAt))}` : 'Marquer comme terminée';
  done.setAttribute('aria-label', t.done ? 'Rouvrir la tâche' : 'Marquer comme terminée');
  $('.detail', pane).classList.toggle('isDone', t.done);
  const top = pane.querySelector('[data-act="top"]');
  if (top) top.hidden = t.done;

  const due = $('#dDue', pane);
  if (document.activeElement !== due) due.value = t.due || '';
  for (const p of $$('.pill[data-due]', pane)) p.setAttribute('aria-pressed', String((p.dataset.due || null) === t.due));
  const hint = $('#dDueHint', pane);
  if (t.due) {
    const n = diffDays(t.due, today);
    hint.textContent = n < 0 && !t.done ? `${cap(longDate(t.due))}, en retard de ${plural(-n, 'jour', 'jours')}.`
      : n === 0 ? `Aujourd'hui, ${longDate(t.due)}.` : n === 1 ? `Demain, ${longDate(t.due)}.` : `${cap(longDate(t.due))}, dans ${plural(n, 'jour', 'jours')}.`;
    hint.classList.toggle('late', n < 0 && !t.done);
  } else { hint.textContent = ''; hint.classList.remove('late'); }

  const rep = $('#dRepeat', pane);
  if (document.activeElement !== rep) rep.value = t.repeat ? t.repeat.type : 'none';
  const nth = $('#dNth', pane);
  nth.hidden = !(t.repeat && t.repeat.type === 'nth');
  if (t.repeat && t.repeat.type === 'nth' && document.activeElement !== nth) nth.value = t.repeat.n;
  const rh = $('#dRepeatHint', pane);
  if (t.repeat) {
    const after = nextAfterCompletion(t);
    rh.textContent = `${repeatSentence(t.repeat)}. Une fois cochée, la tâche revient${t.steps.length ? ', étapes décochées,' : ''} le ${longDate(after)}.`;
  } else rh.textContent = '';

  updateRemindBits(t);
  updateMatrixBits(t);

  const n = t.steps.filter((s) => s.done).length;
  $('#dStepsN', pane).textContent = t.steps.length ? `${n} sur ${t.steps.length}` : '';
  const bar = $('#dBar', pane);
  bar.hidden = !t.steps.length;
  $('i', bar).style.width = t.steps.length ? `${(100 * n) / t.steps.length}%` : '0';

  const created = new Date(t.createdAt);
  const meta = [`Créée le ${F_FULL.format(created)} à ${F_TIME.format(created)}`];
  if (t.done) meta.push(`Terminée le ${F_FULL.format(new Date(t.doneAt))} à ${F_TIME.format(new Date(t.doneAt))}`);
  else if (t.updatedAt !== t.createdAt) meta.push(`Modifiée le ${F_FULL.format(new Date(t.updatedAt))} à ${F_TIME.format(new Date(t.updatedAt))}`);
  $('#dMeta', pane).innerHTML = meta.map((m) => `<p>${esc(m)}</p>`).join('');
  renderLinks(t);
}
function updateMatrixBits(t) {
  const pane = els.detail;
  const hint = $('#dMxHint', pane);
  if (!hint) return;
  for (const b of $$('[data-imp]', pane)) b.setAttribute('aria-pressed', String(JSON.stringify(t.matrix.important) === b.dataset.imp));
  for (const b of $$('[data-urg]', pane)) b.setAttribute('aria-pressed', String(JSON.stringify(t.matrix.urgent) === b.dataset.urg));
  const a = autoUrgent(t), d = state.settings.urgentDays;
  const rule = d === 0 ? 'l\'échéance est aujourd\'hui ou dépassée' : `l'échéance est à ${plural(d, 'jour', 'jours')} ou moins`;
  const auto = t.matrix.urgent === null
    ? `Urgence automatique : ${a ? 'urgente' : 'pas urgente'} pour l'instant (urgente quand ${rule}).`
    : `Urgence forcée : ${t.matrix.urgent ? 'urgente' : 'pas urgente'}, quelle que soit l'échéance.`;
  const q = quadrantOf(t);
  hint.textContent = t.done ? '' : (q === 'inbox' ? `À classer : indiquez si c'est important. ${auto}` : `Cadran « ${QUADS[q].title} ». ${auto}`);
}
function updateRemindBits(t) {
  const pane = els.detail;
  const rd = $('#dRemDate', pane), rt = $('#dRemTime', pane);
  if (!rd) return;
  const r = t.remind;
  if (document.activeElement !== rd) rd.value = r ? r.date : '';
  if (document.activeElement !== rt) rt.value = r ? r.time : '';
  const dtl = hLabel(state.settings.remindTime);
  $('#dRemTomorrow', pane).textContent = `Demain à ${dtl}`;
  const dday = $('#dRemDday', pane);
  dday.textContent = `Le jour J à ${dtl}`;
  dday.hidden = !t.due;
  pane.querySelector('[data-rem="eve"]').hidden = !t.due;
  $('#dRemNone', pane).hidden = !r;
  $('#dIcs', pane).hidden = !r || t.done;
  for (const b of $$('.pill[data-rem]', pane)) b.setAttribute('aria-pressed', 'false');
  const hint = $('#dRemHint', pane);
  hint.classList.remove('late');
  if (!r) { hint.textContent = ''; return; }
  const parts = [];
  if (t.done) parts.push('Tâche terminée : pas de rappel.');
  else if (r.snooze) parts.push(`Rappel reporté ${fmtWhenLong(r.snooze)}.`);
  else if (!r.fired) parts.push(`Notification ${fmtWhenLong(remindMs(r))}.`);
  else if (r.firedAt) parts.push(`Rappel envoyé ${fmtWhenLong(r.firedAt)}.`);
  else { parts.push('Cette heure est déjà passée : choisissez une heure à venir.'); hint.classList.add('late'); }
  if (t.repeat && t.due && !t.done) parts.push(`Il suivra chaque occurrence, ${offsetPhrase(diffDays(r.date, t.due), r.time)}.`);
  if (!t.done && reminders.permission() !== 'granted') parts.push('Il s\'affichera dans l\'application (notifications Windows non activées, voir Réglages).');
  hint.textContent = parts.join(' ');
}
function renderSteps(t, focus) {
  const ol = $('#dSteps', els.detail);
  if (!ol) return;
  ol.innerHTML = t.steps.map((s) => `<li class="step${s.done ? ' done' : ''}" data-sid="${esc(s.id)}">
      <label class="check"><input type="checkbox" data-k="stepchk:${esc(s.id)}"${s.done ? ' checked' : ''} aria-label="${s.done ? 'Décocher' : 'Cocher'} l'étape : ${esc(s.text || 'sans texte')}"><span class="box"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span></label>
      <input type="text" class="stepText" data-k="step:${esc(s.id)}" value="${esc(s.text)}" aria-label="Étape" maxlength="300">
      <button type="button" class="stepDel" data-k="stepdel:${esc(s.id)}" title="Supprimer l'étape" aria-label="Supprimer l'étape">${icon('x')}</button>
    </li>`).join('');
  if (focus) {
    const el = ol.querySelector(`[data-k="step:${CSS.escape(focus.sid)}"]`);
    if (el) { el.focus(); const p = focus.at === 'start' ? 0 : el.value.length; el.setSelectionRange(p, p); }
  }
}
function autosize(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}
const RE_URL = /\bhttps?:\/\/[^\s<>"']{1,2048}/gi;
const RE_PATH = /(?:\b[A-Za-z]:\\|\\\\[^\s\\/:*?"<>|]{1,255}\\)[^\r\n"<>|*?]{0,1024}/g;
function detectLinks(text) {
  const out = [];
  const seen = new Set();
  const push = (kind, v) => {
    let e = v.length;
    while (e && ' \t\r\n.,;:)]'.includes(v[e - 1])) e--; // sans expression régulière (temps linéaire)
    v = v.slice(0, e);
    if (v.length < 4 || seen.has(v)) return;
    seen.add(v); out.push({ kind, v });
  };
  for (const m of text.matchAll(RE_URL)) push('url', m[0]);
  for (const m of text.matchAll(RE_PATH)) push('path', m[0]);
  return out.slice(0, 12);
}
function renderLinks(t) {
  const box = $('#dLinks', els.detail);
  if (!box) return;
  const links = detectLinks(t.notes);
  box.innerHTML = links.map((l, i) => {
    const label = l.kind === 'url' ? l.v.replace(/^https?:\/\//, '').replace(/\/$/, '') : l.v;
    const title = l.kind === 'url' ? `Ouvrir ${l.v}` : `Copier le chemin ${l.v}`;
    return `<button type="button" class="linkChip" data-link="${i}" title="${esc(title)}">${icon(l.kind === 'url' ? 'link' : 'folder')}<span>${esc(label)}</span></button>`;
  }).join('');
  box.hidden = !links.length;
  box._links = links;
}

/* Événements du détail (délégués) */
function bindDetail() {
  const pane = els.detail;
  const cur = () => byId(pane.dataset.id);

  pane.addEventListener('input', (e) => {
    const t = cur(); if (!t) return;
    const el = e.target;
    const k = el.dataset.k || '';
    if (k === 'title') {
      autosize(el);
      const flat = el.value.replace(/[\r\n]+/g, ' ');
      if (flat !== el.value) el.value = flat;
      const v = nfc(flat);
      commit(() => { t.title = v; touch(t); }, {
        undo: 'Modification du titre', coalesce: `title:${t.id}`, detail: false,
        light: () => { const r = rowEl(t.id); const el = r && r.querySelector('.title, .mtitle'); if (el) el.innerHTML = t.title ? esc(t.title) : '<span class="untitled">Sans titre</span>'; },
      });
    } else if (k === 'notes') {
      autosize(el);
      const hadNotes = !!t.notes.trim();
      const nv = nfc(el.value);
      commit(() => { t.notes = nv; touch(t); }, {
        undo: 'Modification des notes', coalesce: `notes:${t.id}`, detail: false,
        light: hadNotes === !!nv.trim() ? () => {} : null, // l'icône « notes » n'apparaît ou ne disparaît que rarement
      });
      linksLater(t);
    } else if (k.startsWith('step:')) {
      const s = t.steps.find((x) => x.id === k.slice(5)); if (!s) return;
      commit(() => { s.text = nfc(el.value); touch(t); }, { undo: "Modification d'une étape", coalesce: k, detail: false, light: () => {} });
    } else if (k === 'nth') {
      const n = parseInt(el.value, 10);
      if (!(n >= 1 && n <= 23)) return;
      commit(() => {
        t.repeat = { type: 'nth', n };
        shiftDue(t, nextOccurrence(t.repeat, todayISO(), true));
        touch(t);
      }, { undo: 'Répétition modifiée', coalesce: `nth:${t.id}`, detail: false });
      updateDetailBits(t);
    }
  });

  pane.addEventListener('change', (e) => {
    const t = cur(); if (!t) return;
    const el = e.target;
    const k = el.dataset.k || '';
    if (k === 'done') { setDone(t.id, el.checked); return; }
    if (k === 'due') {
      const v = isISO(el.value) ? el.value : null;
      if (!v && el.value) return; // saisie incomplète
      setDue(t, v);
    } else if (k === 'remdate' || k === 'remtime') {
      const d = $('#dRemDate', pane).value, tm = $('#dRemTime', pane).value;
      if (k === 'remdate' && !d) { if (t.remind) setRemind(t, null); return; }
      if (k === 'remdate' && !isISO(d)) return;
      if (k === 'remtime' && !isHM(tm)) return;
      const date = isISO(d) ? d : (t.due && t.due >= todayISO() ? t.due : todayISO());
      const time = isHM(tm) ? tm : state.settings.remindTime;
      setRemind(t, { date, time });
    } else if (k === 'repeat') {
      const type = el.value;
      commit(() => {
        if (type === 'none') t.repeat = null;
        else {
          const anchor = t.due || todayISO();
          const n = parseInt($('#dNth', pane).value, 10) || 3;
          t.repeat = makeRepeat(type, anchor, n);
          if (type === 'workday' || type === 'nth' || type === 'last' || !t.due) shiftDue(t, nextOccurrence(t.repeat, todayISO(), true));
        }
        touch(t);
      }, { undo: 'Répétition modifiée', detail: false });
      updateDetailBits(t);
      if (type === 'nth') $('#dNth', pane).focus();
    } else if (k.startsWith('stepchk:')) {
      const s = t.steps.find((x) => x.id === k.slice(8)); if (!s) return;
      commit(() => { s.done = el.checked; touch(t); }, { undo: el.checked ? 'Étape cochée' : 'Étape décochée', detail: false });
      el.closest('.step').classList.toggle('done', s.done);
      updateDetailBits(t);
      if (t.steps.length && t.steps.every((x) => x.done) && !t.done) {
        toast('Toutes les étapes sont faites.', { action: 'Terminer la tâche', onAction: () => setDone(t.id, true) });
      }
    }
  });

  pane.addEventListener('click', (e) => {
    const t = cur(); if (!t) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'back') { closeOverlay(); return; }
    if (b.dataset.act === 'delete') { deleteTask(t.id); return; }
    if (b.dataset.act === 'top') { moveTask(t.id, 'top'); return; }
    if ('due' in b.dataset) { setDue(t, b.dataset.due || null); return; }
    if ('rem' in b.dataset) { setRemind(t, remindPreset(t, b.dataset.rem)); return; }
    if ('imp' in b.dataset || 'urg' in b.dataset) {
      const key = 'imp' in b.dataset ? 'important' : 'urgent';
      const v = JSON.parse('imp' in b.dataset ? b.dataset.imp : b.dataset.urg);
      commit(() => {
        if (key === 'important' && v === null) t.matrix = { important: null, urgent: null };
        else t.matrix[key] = v;
        touch(t);
      }, { undo: key === 'important' ? 'Importance modifiée' : 'Urgence modifiée', detail: false });
      updateMatrixBits(t);
      return;
    }
    if (b.dataset.act === 'ics') { exportIcs([t]); return; }
    if (b.dataset.k && b.dataset.k.startsWith('stepdel:')) { removeStep(t, b.dataset.k.slice(8), 'next'); return; }
    if ('link' in b.dataset) {
      const l = ($('#dLinks', pane)._links || [])[+b.dataset.link];
      if (!l) return;
      if (l.kind === 'url') window.open(l.v, '_blank', 'noopener');
      else copyText(l.v).then((ok) => toast(ok ? 'Chemin copié. Collez-le dans la barre d\'adresse de l\'Explorateur (Win+E).' : 'Copie impossible : sélectionnez le chemin dans les notes.'));
    }
  });

  pane.addEventListener('keydown', (e) => {
    const t = cur(); if (!t) return;
    const el = e.target;
    const k = el.dataset.k || '';
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      el.blur();
      if (overlayMode()) closeOverlay(); else focusSelectionHost();
      return;
    }
    if (k === 'title' && e.key === 'Enter') { e.preventDefault(); $('#dNotes', pane).focus(); return; }
    if (k === 'addstep') {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const v = el.value.trim();
        if (!v) return;
        addSteps(t, [v]);
        el.value = '';
      } else if (e.key === 'ArrowUp' && t.steps.length) {
        e.preventDefault(); focusStep(t.steps[t.steps.length - 1].id);
      } else if (e.key === 'Backspace' && !el.value && t.steps.length) {
        e.preventDefault(); focusStep(t.steps[t.steps.length - 1].id);
      }
      return;
    }
    if (k.startsWith('step:')) {
      const sid = k.slice(5);
      const i = t.steps.findIndex((s) => s.id === sid);
      if (i < 0) return;
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const caret = el.selectionStart;
        const s = t.steps[i];
        const tail = el.value.slice(caret);
        const ns = { id: uid(), text: tail, done: false };
        commit(() => { s.text = el.value.slice(0, caret); t.steps.splice(i + 1, 0, ns); touch(t); }, { undo: 'Ajout d\'étape', detail: false });
        renderSteps(t, { sid: ns.id, at: 'start' });
        updateDetailBits(t);
      } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
        if (!el.value) { e.preventDefault(); removeStep(t, sid, 'prev'); }
        else if (i > 0) { // fusion avec l'étape précédente
          e.preventDefault();
          const prev = t.steps[i - 1];
          const at = prev.text.length;
          commit(() => { prev.text += el.value; t.steps.splice(i, 1); touch(t); }, { undo: 'Fusion d\'étapes', detail: false });
          renderSteps(t);
          const pe = els.detail.querySelector(`[data-k="step:${CSS.escape(prev.id)}"]`);
          if (pe) { pe.focus(); pe.setSelectionRange(at, at); }
          updateDetailBits(t);
        }
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= t.steps.length) return;
        commit(() => { const [s] = t.steps.splice(i, 1); t.steps.splice(j, 0, s); touch(t); }, { undo: 'Déplacement d\'étape', detail: false });
        renderSteps(t, { sid, at: 'end' });
      } else if (e.key === 'ArrowUp' && !e.altKey) {
        if (i > 0) { e.preventDefault(); focusStep(t.steps[i - 1].id); }
      } else if (e.key === 'ArrowDown' && !e.altKey) {
        e.preventDefault();
        if (i < t.steps.length - 1) focusStep(t.steps[i + 1].id); else $('#dAddStep', pane).focus();
      }
    }
  });

  pane.addEventListener('paste', (e) => {
    const el = e.target;
    if (el.dataset.k !== 'addstep') return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const lines = text.split(/\r?\n/).map(cleanStepLine).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const t = cur(); if (!t) return;
    addSteps(t, lines);
    toast(`${lines.length} étapes ajoutées depuis le presse-papiers.`);
  });

  pane.addEventListener('focusout', () => { ui.coalesceKey = null; });
}
const linksLater = debounce((t) => { if (els.detail.dataset.id === t.id) renderLinks(t); }, 250);
function cleanStepLine(l) {
  let out = l;
  for (let i = 0; i < 3; i++) out = out.replace(/^\s*(?:[-*•–—▪◦·]|\d{1,2}[.)]|\[[ xX]?\]|☐|☑|✓)\s+/, '');
  return out.trim();
}
function focusStep(sid) {
  const el = els.detail.querySelector(`[data-k="step:${CSS.escape(sid)}"]`);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function addSteps(t, texts) {
  commit(() => { for (const x of texts) t.steps.push({ id: uid(), text: nfc(x).slice(0, 300), done: false }); touch(t); }, { undo: texts.length > 1 ? 'Ajout d\'étapes' : 'Ajout d\'étape', detail: false });
  renderSteps(t);
  updateDetailBits(t);
}
function removeStep(t, sid, focusWhere) {
  const i = t.steps.findIndex((s) => s.id === sid);
  if (i < 0) return;
  commit(() => { t.steps.splice(i, 1); touch(t); }, { undo: "Suppression d'étape", detail: false });
  renderSteps(t);
  updateDetailBits(t);
  const target = focusWhere === 'prev' ? t.steps[i - 1] : (t.steps[i] || t.steps[i - 1]);
  if (target) focusStep(target.id); else $('#dAddStep', els.detail).focus();
}
function remindPreset(t, kind) {
  const today = todayISO(), dt = state.settings.remindTime;
  if (kind === 'none') return null;
  if (kind === '1h') { const d = new Date(Date.now() + 3600000); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return { date: toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
  if (kind === 'tomorrow') return { date: addDays(today, 1), time: dt };
  if (kind === 'dday') return { date: t.due || today, time: dt };
  if (kind === 'eve') return { date: addDays(t.due || today, -1), time: '17:00' };
  return null;
}
function setRemind(t, v) {
  commit(() => {
    t.remind = v ? makeRemind(v.date, v.time) : null;
    touch(t);
  }, { undo: v ? 'Rappel modifié' : 'Rappel retiré', detail: false });
  updateDetailBits(t);
  reminders.refresh();
  if (v) reminders.askPermission();
}
function setDue(t, v) {
  commit(() => {
    shiftDue(t, v);
    if (!v) t.repeat = null;
    else if (t.repeat && (t.repeat.type === 'weekly' || t.repeat.type === 'monthly')) t.repeat = makeRepeat(t.repeat.type, v);
    touch(t);
  }, { undo: v ? 'Échéance modifiée' : 'Échéance retirée', detail: false });
  updateDetailBits(t);
}

/* =====================================================================
   Rappels : moteur, notifications Windows, cartes dans l'application
   ===================================================================== */
const BELL_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C98204'/%3E%3Cpath d='M10 21v-6.5a6 6 0 0 1 12 0V21l1.5 2h-15zM14 25a2 2 0 0 0 4 0' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const reminders = {
  leader: false,
  asked: false,
  timer: null,
  sig: '',
  blink: null,
  testCard: false,
  notes: new Map(), // notifications Windows ouvertes, par tâche
  audio: null,

  permission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  },

  init() {
    // Un seul onglet sonne : celui qui détient le verrou (les autres prennent le relais s'il se ferme).
    if (navigator.locks && navigator.locks.request) {
      navigator.locks.request('odj-rappels', () => { this.leader = true; this.check(); return new Promise(() => {}); })
        .catch(() => { this.leader = true; this.check(); });
    } else this.leader = true;
    this.timer = setInterval(() => this.check(), 15000);
    document.addEventListener('visibilitychange', () => this.check());
    window.addEventListener('focus', () => this.check());
    window.addEventListener('pageshow', () => this.check());
    // le son a besoin d'une première interaction avec la page
    const unlock = () => { this.ensureAudio(); window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    els.rcards.addEventListener('click', (e) => this.onCardClick(e));
    this.refresh();
  },

  /* Vérifie toutes les tâches ; déclenche ce qui est échu. Appelée toutes les 15 s, et au retour sur la page. */
  check() {
    if (!this.leader) { this.refresh(); return; }
    const now = Date.now();
    const fire = state.tasks.filter((t) => { const n = remindNext(t); return n !== null && n <= now; });
    if (fire.length) {
      commit(() => {
        for (const t of fire) Object.assign(t.remind, { fired: true, ack: false, snooze: null, firedAt: now });
      }, { undo: false, detail: false });
      const sel = byId(ui.selectedId);
      if (sel) updateDetailBits(sel);
      this.announce(fire);
    }
    this.refresh();
  },

  announce(list) {
    const visible = document.visibilityState === 'visible' && document.hasFocus();
    let notified = false;
    if (this.permission() === 'granted' && !visible) {
      try {
        if (list.length > 3) {
          this.notify('summary', `${list.length} rappels en attente`, list.slice(0, 3).map((t) => `• ${t.title || 'Sans titre'}`).join('\n') + '\n…');
        } else for (const t of list) this.notify(t.id, t.title || 'Sans titre', notifBody(t));
        notified = true;
      } catch (e) { console.warn('Notification', e); }
    }
    // Notification Windows : Windows joue son propre son. Sinon, petit carillon dans la page.
    if (state.settings.remindSound && !notified) this.chime();
    requestAnimationFrame(() => {
      for (const el of $$('.rcard', els.rcards)) if (list.some((t) => t.id === el.dataset.id)) el.classList.add('ringing');
    });
  },

  notify(tag, title, body) {
    const n = new Notification(title, {
      body: body || 'Cliquez pour ouvrir la tâche.', tag: `odj-${tag}`, icon: BELL_ICON, badge: BELL_ICON,
      requireInteraction: state.settings.remindSticky,
      silent: !state.settings.remindSound,
    });
    n.onclick = () => {
      window.focus();
      if (tag !== 'summary' && byId(tag)) { if (ui.view === 'done') setView('todo'); select(tag, { open: true }); }
      n.close();
    };
    this.notes.set(tag, n);
  },
  closeNote(id) { const n = this.notes.get(id); if (n) { try { n.close(); } catch (e) { /* ignore */ } this.notes.delete(id); } },

  ensureAudio() {
    if (this.audio) { if (this.audio.state === 'suspended') this.audio.resume().catch(() => {}); return this.audio; }
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) this.audio = new C(); } catch (e) { this.audio = null; }
    return this.audio;
  },
  /* Deux notes douces (mi, si), synthétisées : aucun fichier son embarqué. */
  chime() {
    const ac = this.ensureAudio();
    if (!ac || ac.state !== 'running') return;
    const t0 = ac.currentTime + 0.02;
    [[659.25, 0], [987.77, 0.16]].forEach(([f, dt]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.9);
      o.connect(g).connect(ac.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 1);
    });
  },

  async askPermission(explicit = false) {
    if (this.permission() !== 'default') {
      if (explicit && this.permission() === 'denied') toast('Les notifications sont bloquées pour cette page : cliquez sur l\'icône à gauche de l\'adresse dans Chrome, puis autorisez les notifications.', { duration: 9000 });
      return;
    }
    if (this.asked && !explicit) return;
    this.asked = true;
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') toast('Notifications Windows activées pour les rappels.');
      else if (explicit || p === 'denied') toast('Notifications Windows non autorisées : les rappels s\'afficheront dans l\'application, avec un son.', { duration: 8000 });
    } catch (e) { /* ignore */ }
    this.renderSettings();
    const sel = byId(ui.selectedId); if (sel) updateDetailBits(sel);
  },

  test() {
    toast('Rappel de test dans 5 secondes : vous pouvez passer sur une autre fenêtre.');
    setTimeout(() => {
      this.testCard = true;
      this.refresh();
      const visible = document.visibilityState === 'visible' && document.hasFocus();
      let notified = false;
      if (this.permission() === 'granted' && !visible) {
        try { this.notify('test', 'Rappel de test', 'Les rappels de To do list fonctionnent sur ce poste.'); notified = true; } catch (e) { /* ignore */ }
      }
      if (state.settings.remindSound && !notified) this.chime();
      const c = els.rcards.querySelector('[data-id="test"]'); if (c) c.classList.add('ringing');
    }, 5000);
  },

  pending() { return state.tasks.filter(remindRinging).sort((x, y) => (x.remind.firedAt || 0) - (y.remind.firedAt || 0)); },

  /* Redessine les cartes (seulement si quelque chose a changé) et le titre de l'onglet. */
  refresh() {
    const list = this.pending();
    if (document.querySelector('dialog[open]')) { this.titleBlink(list.length + (this.testCard ? 1 : 0)); return; } // repris à la fermeture du dialogue
    const sig = JSON.stringify([this.testCard, list.map((t) => [t.id, t.title, t.remind.firedAt, t.due, t.steps.map((s) => s.done)])]);
    if (sig !== this.sig) {
      this.sig = sig;
      const shown = list.slice(0, 3);
      let html = '';
      if (this.testCard) html += cardHTML({ id: 'test', title: 'Rappel de test', remind: { firedAt: Date.now() }, steps: [], due: null }, true);
      html += shown.map((t) => cardHTML(t)).join('');
      if (list.length > shown.length) html += `<div class="rmore">${plural(list.length - shown.length, 'autre rappel', 'autres rappels')} en attente</div>`;
      const ringing = new Set($$('.rcard.ringing', els.rcards).map((e) => e.dataset.id));
      const focusId = els.rcards.contains(document.activeElement) ? document.activeElement.dataset.f : null;
      els.rcards.innerHTML = html;
      for (const el of $$('.rcard', els.rcards)) if (ringing.has(el.dataset.id)) el.classList.add('ringing');
      if (focusId) { const f = els.rcards.querySelector(`[data-f="${CSS.escape(focusId)}"]`); if (f) f.focus(); }
      const show = !!html;
      if (typeof els.rcards.showPopover === 'function') {
        try { if (show) { if (els.rcards.matches(':popover-open')) els.rcards.hidePopover(); els.rcards.showPopover(); } else if (els.rcards.matches(':popover-open')) els.rcards.hidePopover(); } catch (e) { /* ignore */ }
      }
      els.rcards.hidden = !show;
    }
    // seul le retard (« il y a 12 min ») évolue chaque minute : mise à jour du texte, sans tout reconstruire
    for (const el of $$('.rcard[data-planned]', els.rcards)) {
      const s = el.querySelector('.late');
      const txt = lateText(+el.dataset.planned);
      if (s) s.textContent = txt; else if (txt) { const sp = document.createElement('span'); sp.className = 'late'; sp.textContent = txt; el.querySelector('.rhead > span:not(.grow)').appendChild(sp); }
    }
    // notifications Windows des rappels traités ailleurs (autre onglet, case cochée…)
    for (const id of Array.from(this.notes.keys())) {
      if (id === 'test') continue;
      if (id === 'summary' ? !list.length : !list.some((t) => t.id === id)) this.closeNote(id);
    }
    this.titleBlink(list.length + (this.testCard ? 1 : 0));
  },

  titleBlink(n) {
    const icon = $('link[rel="icon"]');
    if (!this.baseIcon && icon) this.baseIcon = icon.href;
    if (n && !this.blink) {
      if (icon) icon.href = BELL_ICON;
      let on = false;
      this.blink = setInterval(() => {
        on = !on;
        const list = this.pending();
        const count = list.length + (this.testCard ? 1 : 0);
        const p = list[0];
        document.title = on ? `🔔 ${p ? truncate(p.title || 'Rappel', 40) : 'Rappel'}` : `(${count}) Rappel, ${APP_NAME}`;
      }, 1300);
    } else if (!n && this.blink) {
      clearInterval(this.blink); this.blink = null;
      if (icon && this.baseIcon) icon.href = this.baseIcon;
      renderHeader();
    }
  },

  act(id, how) {
    if (id === 'test') { this.testCard = false; this.closeNote('test'); this.refresh(); if (document.activeElement === document.body) focusSelectionHost(); return; }
    const t = byId(id);
    if (!t || !t.remind) { this.refresh(); return; }
    this.closeNote(id);
    if (how === 'done') { commit(() => { t.remind.ack = true; touch(t); }, { undo: false, detail: false }); setDone(id, true); }
    else if (how === 'open' || how === 'ok') {
      commit(() => { t.remind.ack = true; touch(t); }, { undo: false, detail: false });
      if (how === 'open') { window.focus(); if (ui.view === 'done') setView('todo'); select(id, { open: true }); }
    } else if (how.startsWith('snz:')) {
      const ms = snoozeTarget(how.slice(4));
      commit(() => { t.remind.snooze = ms; t.remind.ack = false; touch(t); }, { undo: false, detail: false });
      toast(`Rappel reporté ${fmtWhenLong(ms)}.`);
    }
    const sel = byId(ui.selectedId); if (sel) updateDetailBits(sel);
    this.refresh();
    // la carte a disparu : rendre le focus à la liste plutôt qu'à la page
    if (how !== 'open' && (document.activeElement === document.body || !document.activeElement)) focusSelectionHost();
  },
  onCardClick(e) {
    const b = e.target.closest('[data-ract]');
    if (!b) return;
    const card = b.closest('.rcard');
    if (card) this.act(card.dataset.id, b.dataset.ract);
  },

  renderSettings() {
    const txt = $('#setRemText'), btns = $('#setRemBtns');
    if (!txt) return;
    const p = this.permission();
    const state1 = p === 'granted'
      ? `<span class="permState on">${icon('ok')}Notifications Windows activées</span>`
      : p === 'denied' ? `<span class="permState off">${icon('alert')}Notifications Windows bloquées</span>`
        : p === 'unsupported' ? `<span class="permState off">${icon('alert')}Notifications Windows indisponibles</span>`
          : `<span class="permState off">${icon('bell')}Notifications Windows pas encore autorisées</span>`;
    const expl = p === 'granted'
      ? 'Quand la page n\'est pas au premier plan, le rappel apparaît en notification Windows ; quand vous êtes dessus, une carte s\'affiche en bas à droite.'
      : p === 'denied' ? 'Les rappels s\'affichent dans l\'application avec un son, et le titre de l\'onglet clignote. Pour les notifications Windows, cliquez sur l\'icône à gauche de l\'adresse dans Chrome et autorisez-les.'
        : 'Les rappels s\'affichent dans l\'application avec un son, et le titre de l\'onglet clignote. Autorisez les notifications pour les voir aussi par-dessus vos autres fenêtres.';
    txt.innerHTML = `${state1}<br>${esc(expl)}`;
    const n = state.tasks.filter((t) => !t.done && t.remind && remindNext(t)).length;
    btns.innerHTML = `${p === 'default' || p === 'denied' ? `<button type="button" class="btn primary" data-rset="enable">${icon('bell')}Activer les notifications Windows</button>` : ''}
      <button type="button" class="btn" data-rset="test">${icon('clock')}Tester un rappel</button>
      ${n ? `<button type="button" class="btn" data-rset="ics-all">${icon('cal')}${n > 1 ? `Envoyer les ${n} rappels à venir vers Outlook` : 'Envoyer le rappel à venir vers Outlook'}</button>` : ''}`;
  },
};
function notifBody(t) {
  const bits = [];
  if (t.due) { const d = dueInfo(t.due); bits.push(`Échéance : ${d.text.toLowerCase() === 'aujourd\'hui' ? 'aujourd\'hui' : d.text}`); }
  const next = t.steps.find((s) => !s.done && s.text.trim());
  if (next) bits.push(`Prochaine étape : ${next.text}`);
  else if (t.notes.trim()) bits.push(truncate(t.notes.trim().split(/\r?\n/)[0], 90));
  return bits.join('\n');
}
function snoozeTarget(kind) {
  const now = Date.now();
  if (kind === '10m') return now + 10 * 60000;
  if (kind === '1h') return now + 3600000;
  const [h, m] = state.settings.remindTime.split(':').map(Number);
  const d = fromISO(addDays(todayISO(), 1)); d.setHours(h, m, 0, 0);
  return d.getTime();
}
function lateText(planned) {
  const lateMin = Math.round((Date.now() - planned) / 60000);
  if (lateMin < 2) return '';
  return `, ${lateMin < 60 ? `il y a ${lateMin} min` : lateMin < 1440 ? `il y a ${Math.floor(lateMin / 60)} h ${pad(lateMin % 60)}` : `prévu ${fmtWhenLong(planned)}`}`;
}
function cardHTML(t, isTest = false) {
  const firedAt = t.remind.firedAt || Date.now();
  const planned = isTest ? firedAt : (t.remind.date ? remindMs(t.remind) : firedAt);
  const lt = lateText(planned);
  const late = lt ? `<span class="late">${esc(lt)}</span>` : '';
  const sub = isTest ? 'Les rappels fonctionnent sur ce poste.' : notifBody(t).split('\n').join('. ');
  const tom = hLabel(state.settings.remindTime);
  return `<div class="rcard" data-id="${esc(t.id)}" data-planned="${planned}" role="group" aria-label="Rappel : ${esc(t.title || 'Sans titre')}">
    <div class="rhead">${icon('bell')}<span>Rappel de ${esc(F_TIME.format(new Date(planned)))}${late}</span><span class="grow"></span>
      <button type="button" class="rclose" data-ract="ok" data-f="${esc(t.id)}:ok" title="Fermer le rappel" aria-label="Fermer le rappel">${icon('x')}</button></div>
    <div class="rtitle">${esc(t.title || 'Sans titre')}</div>
    ${sub ? `<p class="rsub">${esc(sub)}</p>` : '<div class="rgap"></div>'}
    ${isTest ? '<div class="ractions"><button type="button" class="btn primary" data-ract="ok" data-f="test:ok2">Parfait</button></div>' : `<div class="ractions">
      <button type="button" class="btn primary" data-ract="open" data-f="${esc(t.id)}:open">Ouvrir</button>
      <button type="button" class="btn" data-ract="done" data-f="${esc(t.id)}:done">${icon('ok')}Terminer</button>
      <span class="snz"><span>Reporter</span>
        <button type="button" class="pill" data-ract="snz:10m" data-f="${esc(t.id)}:10m" title="Reporter de 10 minutes">10 min</button>
        <button type="button" class="pill" data-ract="snz:1h" data-f="${esc(t.id)}:1h" title="Reporter d'une heure">1 h</button>
        <button type="button" class="pill" data-ract="snz:tomorrow" data-f="${esc(t.id)}:tom" title="Reporter à demain ${esc(tom)}">Demain</button>
      </span>
    </div>`}
  </div>`;
}

/* ---------- Outlook : fichier .ics avec rappel (fonctionne même navigateur fermé) ---------- */
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, ''); }
function icsFold(line) {
  // lignes de 75 octets maximum (RFC 5545), coupées sans casser un caractère UTF-8
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', len = 0, limit = 75;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (len + l > limit) { out.push(cur); cur = ' '; len = 1; limit = 75; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join('\r\n');
}
const icsLocal = (iso, hm) => `${iso.replace(/-/g, '')}T${hm.replace(':', '')}00`;
const icsUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function isCetZone() {
  const y = new Date().getFullYear();
  return new Date(y, 0, 15).getTimezoneOffset() === -60 && new Date(y, 6, 15).getTimezoneOffset() === -120;
}
const VTZ_CET = (tz) => ['BEGIN:VTIMEZONE', `TZID:${tz}`,
  'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:CET', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:CEST', 'END:DAYLIGHT',
  'END:VTIMEZONE'];
/* Règle de répétition Outlook équivalente, ou null si Outlook ne sait pas l'exprimer. */
function icsRule(rep) {
  if (!rep) return null;
  const WD = 'MO,TU,WE,TH,FR';
  switch (rep.type) {
    case 'workday': return `FREQ=WEEKLY;BYDAY=${WD}`;
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${ICS_DAYS[rep.wd]}`;
    case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${rep.dom === 31 ? -1 : rep.dom}`;
    case 'nth': return rep.n <= 4 ? `FREQ=MONTHLY;BYDAY=${WD};BYSETPOS=${rep.n}` : null;
    case 'last': return `FREQ=MONTHLY;BYDAY=${WD};BYSETPOS=-1`;
    default: return null;
  }
}
function icsEvent(t, tz, notes) {
  const r = t.remind;
  // Événement placé à l'heure du rappel ; s'il y a une échéance et une répétition, sur la date d'échéance
  // avec une alerte décalée, pour que la série Outlook suive les mêmes dates que l'application.
  let start = r.date, trigger = '-PT0M', rule = null;
  const offset = t.due ? diffDays(r.date, t.due) : 0;
  if (t.repeat && t.due && offset <= 0) {
    rule = icsRule(t.repeat);
    if (rule) { start = t.due; trigger = offset === 0 ? '-PT0M' : `-P${-offset}D`; }
    else notes.push(`« ${t.title} » : Outlook ne sait pas répéter « ${repeatSentence(t.repeat).toLowerCase()} » ; seule la prochaine occurrence est ajoutée.`);
  } else if (t.repeat) notes.push(`« ${t.title} » : seule la prochaine occurrence est ajoutée (rappel après l'échéance).`);
  if (rule && t.repeat.type === 'monthly' && (t.repeat.dom === 29 || t.repeat.dom === 30)) {
    notes.push(`« ${t.title} » : Outlook saute les mois qui n'ont pas de ${t.repeat.dom} (février) ; l'application, elle, prend le dernier jour du mois.`);
  }
  if (rule && (t.repeat.type !== 'weekly' && t.repeat.type !== 'monthly') && state.settings.holidays) {
    notes.push(`« ${t.title} » : Outlook ne connaît pas les jours fériés ; une occurrence peut tomber sur un férié.`);
  }
  const endHm = (() => { const [h, m] = r.time.split(':').map(Number); const d = new Date(2000, 0, 1, h, m + 15); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; })();
  const endDate = r.time >= '23:45' ? addDays(start, 1) : start;
  const dt = (iso, hm) => (tz ? `;TZID=${tz}:${icsLocal(iso, hm)}` : `:${icsLocal(iso, hm)}`);
  const desc = [];
  if (t.due) desc.push(`Échéance : ${longDate(t.due)}`);
  const open = t.steps.filter((s) => !s.done);
  if (open.length) desc.push('Étapes :', ...open.map((s) => `- ${s.text}`));
  if (t.notes.trim()) desc.push('', t.notes.trim());
  desc.push('', `Créé depuis ${APP_NAME}.`);
  return ['BEGIN:VEVENT',
    `UID:${icsEsc(t.seriesId || t.id)}@ordre-du-jour`,
    `DTSTAMP:${icsUtc(Date.now())}`,
    `SEQUENCE:${Math.floor(Date.now() / 1000) % 2000000000}`,
    `DTSTART${dt(start, r.time)}`,
    `DTEND${dt(endDate, endHm)}`,
    ...(rule ? [`RRULE:${rule}`] : []),
    `SUMMARY:${icsEsc(t.title || 'Tâche')}`,
    `DESCRIPTION:${icsEsc(desc.join('\n'))}`,
    'TRANSP:TRANSPARENT',
    'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t.title || 'Rappel')}`, `TRIGGER:${trigger}`, 'END:VALARM',
    'END:VEVENT'];
}
function buildIcs(tasks) {
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const tz = isCetZone() ? (zone && zone.startsWith('Europe/') ? zone : 'Europe/Paris') : null;
  const notes = [];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//To do list//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (tz) lines.push(...VTZ_CET(tz));
  for (const t of tasks) if (t.remind) lines.push(...icsEvent(t, tz, notes));
  lines.push('END:VCALENDAR');
  return { text: lines.map(icsFold).join('\r\n') + '\r\n', notes };
}
function exportIcs(tasks) {
  tasks = tasks.filter((t) => t.remind && !t.done);
  if (!tasks.length) { toast('Aucun rappel à envoyer vers Outlook.'); return; }
  const { text, notes } = buildIcs(tasks);
  const slug = tasks.length === 1 ? fold(tasks[0].title || 'tache').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tache' : `${tasks.length}-rappels`;
  download(`rappel-${slug}.ics`, text, 'text/calendar');
  const head = tasks.length === 1
    ? 'Fichier Outlook téléchargé : ouvrez-le puis cliquez sur Enregistrer et fermer. Le rappel fonctionnera même Chrome fermé.'
    : `${tasks.length} rappels exportés : ouvrez le fichier téléchargé, Outlook les ajoute à votre calendrier.`;
  toast(notes.length ? `${head} ${notes[0]}` : head, { duration: 10000 });
}

/* =====================================================================
   Application installable (version web) : hors ligne, mise à jour, installation
   ===================================================================== */
const KEY_INSTALL_LATER = 'odj.install.later';
const pwa = {
  web: /^https?:$/.test(location.protocol),
  promptEvent: null,
  reg: null,
  standalone() { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches; },
  init() {
    if (!this.web) return;
    // Demander à Chrome de ne jamais effacer les données de l'application pour libérer de la place.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.promptEvent = e; this.render(); });
    window.addEventListener('appinstalled', () => {
      this.promptEvent = null; this.render();
      toast('To do list est installée : ouvrez-la depuis le menu Démarrer ou la barre des tâches.', { duration: 9000 });
    });
    matchMedia('(display-mode: standalone)').addEventListener('change', () => this.render());
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        this.reg = reg;
        if (reg.waiting && navigator.serviceWorker.controller) this.offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) this.offerUpdate(w); });
        });
        setInterval(() => reg.update().catch(() => {}), 3 * 3600000);
      }).catch((e) => console.warn('Mode hors ligne indisponible', e));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !this.updating) return;
        reloading = true;
        fileSync.flush();
        setTimeout(() => location.reload(), 150);
      });
    }
    // Raccourcis de l'icône (clic droit dans la barre des tâches)
    const q = new URLSearchParams(location.search);
    if (q.has('nouvelle')) setTimeout(() => els.qa.focus(), 50);
    if (q.get('vue') === 'aujourdhui') setTimeout(() => setView('today'), 0);
    if (q.get('tache')) { const id = q.get('tache'); setTimeout(() => openTaskFromNotification(id), 0); }
    if (q.toString()) { try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* ignore */ } }
    this.render();
  },
  offerUpdate(worker) {
    toast('Une nouvelle version de To do list est prête.', {
      action: 'Mettre à jour', duration: 60000,
      onAction: () => { this.updating = true; worker.postMessage('skipWaiting'); },
    });
  },
  async install() {
    if (isIos()) {
      toast('Sur iPhone : touchez le bouton Partager de Safari (le carré avec une flèche), puis « Sur l\'écran d\'accueil ». Ouvrez ensuite To do list depuis son icône.', { duration: 14000 });
      return;
    }
    if (!this.promptEvent) {
      toast('Pour installer : cliquez sur l\'icône d\'installation à droite de la barre d\'adresse de Chrome, ou menu ⋮, puis « Caster, enregistrer et partager », puis « Installer la page en tant qu\'application ».', { duration: 12000 });
      return;
    }
    const e = this.promptEvent;
    this.promptEvent = null;
    try { await e.prompt(); await e.userChoice; } catch (err) { /* ignore */ }
    this.render();
  },
  render() {
    const card = $('#installCard');
    if (!card) return;
    const later = +(lsGet(KEY_INSTALL_LATER) || 0);
    const ios = isIos() && !this.standalone();
    card.hidden = !(this.web && !this.standalone() && (this.promptEvent || ios) && ui.view === 'todo' && !ui.query.trim() && Date.now() - later > 3 * 86400000);
    card.classList.toggle('ios', ios);
    renderSetupCard();
    // Réglages
    const sec = $('#setAppSec');
    if (!sec) return;
    sec.hidden = !this.web;
    if (!this.web) return;
    const txt = $('#setAppText'), btns = $('#setAppBtns');
    if (this.standalone()) {
      txt.textContent = `Application installée, version ${VERSION}. Les mises à jour arrivent toutes seules ; vos tâches restent sur cet ordinateur.`;
      btns.innerHTML = `<button type="button" class="btn" data-app="share">${icon('link')}Copier le lien à partager</button>`;
    } else {
      txt.textContent = `Version ${VERSION}, ouverte dans un onglet. Installez l'application pour l'ouvrir dans sa propre fenêtre et garder la sauvegarde automatique active en permanence.`;
      btns.innerHTML = `<button type="button" class="btn primary" data-app="install">${icon('install')}Installer l'application</button>
        <button type="button" class="btn" data-app="share">${icon('link')}Copier le lien à partager</button>`;
    }
  },
  shareLink() {
    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    copyText(url).then((ok) => toast(ok ? `Lien copié : ${url}. Chaque collègue aura sa propre liste, sur son propre ordinateur.` : `Lien : ${url}`, { duration: 9000 }));
  },
};

/* ---------- Statut de la sauvegarde ---------- */
/* Carte de mise en route : tant qu'aucun fichier n'est choisi, on propose de le faire une fois pour toutes. */
const KEY_SETUP_LATER = 'odj.setup.later';
function renderSetupCard() {
  const el = $('#setupCard');
  if (!el) return;
  const sc = $('#syncCard');
  if (sc) {
    const later = +(lsGet('odj.synccard.later') || 0);
    sc.hidden = !(typeof cloud !== 'undefined' && cloud.enabled && !cloud.isOn() && !fileSync.supported && ui.view === 'todo' && !ui.query.trim() && Date.now() - later > 3 * 86400000);
  }
  el.hidden = !setupCardWanted();
}
function setupCardWanted() {
  const later = +(lsGet(KEY_SETUP_LATER) || 0);
  const installPending = typeof pwa !== 'undefined' && !$('#installCard').hidden;
  const cloudOn = typeof cloud !== 'undefined' && cloud.isOn();
  return fileSync.supported && !fileSync.handle && !!fileSync.ready && !installPending && !cloudOn && ui.view === 'todo' && !ui.query.trim() && Date.now() - later > 3 * 86400000;
}
function renderStatus() {
  renderSetupCard();
  let s = fileSync.status();
  if (typeof cloud !== 'undefined' && cloud.enabled && (cloud.isOn() || cloud.isDead())) {
    const c = cloud.statusLine();
    if (!(c.tone === 'ok' && (s.tone === 'warn' || s.tone === 'err'))) s = c;
  }
  const el = els.status;
  el.className = `status ${s.tone}`;
  el.innerHTML = `${icon(s.icon)}<span class="msg" title="${esc(s.title || s.text)}">${esc(s.text)}</span><span class="grow"></span>${s.action ? `<button type="button" class="linkBtn" data-status-act="${s.action.id}">${esc(s.action.label)}</button>` : ''}`;
}

/* =====================================================================
   Fichier de sauvegarde automatique (File System Access API, Chrome)
   ===================================================================== */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('odj', 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  get(k) { return this.tx('readonly', (s) => s.get(k)); },
  set(k, v) { return this.tx('readwrite', (s) => s.put(v, k)); },
  del(k) { return this.tx('readwrite', (s) => s.delete(k)); },
};

const fileSync = {
  supported: typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function',
  handle: null,
  state: 'none', // none | ok | permission | error
  error: '',
  lastWrite: 0,
  lastModified: 0,
  writing: false,
  again: false,
  timer: null,

  status() {
    if (!ui.storageOk && this.state !== 'ok') {
      return { tone: 'err', icon: 'alert', text: 'Le navigateur bloque l\'enregistrement local.', title: 'Liez un fichier de sauvegarde ou exportez vos tâches avant de fermer la page.', action: this.supported ? { id: 'link', label: 'Lier un fichier' } : { id: 'export', label: 'Exporter' } };
    }
    if (this.state === 'ok') {
      const at = this.lastWrite ? ` à ${F_TIME.format(new Date(this.lastWrite))}` : '';
      return { tone: 'ok', icon: 'ok', text: `Sauvegarde automatique dans ${this.handle.name}${at}`, title: 'Chaque modification est enregistrée toute seule dans ce fichier.', action: null };
    }
    if (this.state === 'permission') {
      return { tone: 'warn', icon: 'alert', text: 'Sauvegarde du fichier en pause : cliquez n\'importe où pour la reprendre.', title: `Chrome demande de confirmer l'accès à ${this.handle.name}. Choisissez « Autoriser à chaque visite » pour que la sauvegarde reprenne toute seule. En attendant, vos tâches restent enregistrées dans Chrome.`, action: { id: 'reconnect', label: 'Reprendre' } };
    }
    if (this.state === 'error') {
      return { tone: 'err', icon: 'alert', text: `Écriture impossible dans ${this.handle ? this.handle.name : 'le fichier'} : ${this.error}`, action: { id: 'retry', label: 'Réessayer' } };
    }
    if (!this.supported) {
      return { tone: '', icon: 'save', text: 'Enregistré dans ce navigateur. Exportez de temps en temps pour garder une copie.', action: { id: 'export', label: 'Exporter' } };
    }
    return { tone: '', icon: 'save', text: 'Enregistré dans Chrome uniquement.', title: 'Un fichier sur OneDrive protège vos tâches si Chrome est réinitialisé.', action: { id: 'create', label: 'Activer la sauvegarde automatique' } };
  },

  async init() {
    await this._init();
    this.ready = true;
    renderList();
    renderSetupCard();
  },
  async _init() {
    if (!this.supported) { renderStatus(); return; }
    try {
      const h = await idb.get('handle');
      if (!h) { renderStatus(); return; }
      this.handle = h;
      const p = await h.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') await this.reconcile();
      else { this.state = 'permission'; this.armAutoReconnect(); }
    } catch (e) {
      console.warn('Fichier de sauvegarde', e);
      this.state = this.handle ? 'error' : 'none';
      this.error = errText(e);
    }
    renderStatus();
  },

  async createNew() {
    let h;
    try {
      h = await window.showSaveFilePicker({ suggestedName: 'to-do-list.json', types: [{ description: 'Sauvegarde To do list', accept: { 'application/json': ['.json'] } }] });
    } catch (e) { if (e.name !== 'AbortError') toast(pickerError(e, 'créer le fichier')); return; }
    this.handle = h;
    await this.remember(h);
    this.state = 'ok';
    // Si l'utilisateur a choisi un fichier existant (ancienne sauvegarde), on fusionne au lieu d'écraser.
    try { await this.reconcile(); } catch (e) { this.state = 'error'; this.error = errText(e); }
    renderStatus(); renderSetupCard();
    if (this.state === 'ok') toast(`Sauvegarde automatique activée : chaque modification est enregistrée toute seule dans ${h.name}.`, { duration: 7000 });
    refreshSettings();
  },

  async openExisting() {
    let h;
    try {
      [h] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Sauvegarde To do list', accept: { 'application/json': ['.json'] } }] });
    } catch (e) { if (e.name !== 'AbortError') toast(pickerError(e, 'ouvrir le fichier')); return; }
    try {
      const p = await h.requestPermission({ mode: 'readwrite' });
      if (p !== 'granted') { toast('Chrome n\'a pas accordé l\'accès en écriture à ce fichier.'); return; }
      const text = await (await h.getFile()).text();
      let data = null;
      if (text.trim()) {
        try { data = normData(JSON.parse(text)); } catch (e) { data = null; }
        if (!data) { toast('Ce fichier n\'est pas une sauvegarde To do list valide.'); return; }
      }
      if (data && data.tasks.length && state.tasks.length && serialize(data) !== serialize()) {
        const choice = await confirmDialog({
          title: 'Quelles tâches garder ?',
          text: `Le fichier contient ${plural(data.tasks.length, 'tâche', 'tâches')}, ce navigateur en contient ${state.tasks.length}.`,
          buttons: [
            { id: 'cancel', label: 'Annuler' },
            { id: 'local', label: 'Garder celles du navigateur' },
            { id: 'file', label: 'Charger celles du fichier', primary: true },
          ],
        });
        if (choice === 'cancel' || !choice) return;
        if (choice === 'file') loadData(data, 'Chargement du fichier');
      } else if (data && data.tasks.length && !state.tasks.length) loadData(data, 'Chargement du fichier');
      this.handle = h;
      await this.remember(h);
      this.state = 'ok';
      await this.writeNow();
      toast(`Sauvegarde automatique activée dans ${h.name}.`);
    } catch (e) { toast(`Impossible d'utiliser ce fichier : ${errText(e)}`); }
    refreshSettings();
  },

  async remember(h) { try { await idb.set('handle', h); } catch (e) { console.warn('Mémorisation du fichier impossible', e); } },

  async unlink() {
    try { await idb.del('handle'); } catch (e) { /* ignore */ }
    this.handle = null; this.state = 'none'; this.error = '';
    renderStatus(); refreshSettings();
    toast('Le fichier n\'est plus lié. Vos tâches restent dans ce navigateur, et le fichier n\'a pas été supprimé.');
  },

  /* Chrome n'autorise la demande d'accès qu'à la suite d'un geste de l'utilisateur :
     on la fait donc au tout premier clic (ou à la première touche) dans l'application. */
  armAutoReconnect() {
    if (this.armed || this.autoDeclined) return;
    this.armed = true;
    const go = (e) => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock'].includes(e.key)) return;
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
      this.armed = false;
      if (this.state === 'permission' && this.handle) this.reconnect({ auto: true });
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  },
  async reconnect({ auto = false } = {}) {
    if (!this.handle) return;
    try {
      const p = await this.handle.requestPermission({ mode: 'readwrite' }); // appel immédiat, dans le geste
      if (p !== 'granted') {
        if (auto) this.autoDeclined = true; // on ne redemande pas tout seul pendant cette session
        toast('Accès au fichier refusé : vos tâches restent enregistrées dans Chrome. Cliquez sur « Reprendre » en bas à gauche quand vous voulez.', { duration: 8000 });
        renderStatus(); refreshSettings();
        return;
      }
      await this.reconcile();
      if (this.state === 'ok') toast(`Sauvegarde automatique reprise dans ${this.handle.name}.`);
    } catch (e) { this.state = 'error'; this.error = errText(e); }
    renderStatus(); refreshSettings();
  },

  /* Rapproche le fichier et le navigateur. Rien n'est jamais écrasé sans fusion :
     chaque tâche garde sa version la plus récente, et les deux états sont sauvegardés avant. */
  async reconcile() {
    const f = await this.handle.getFile();
    const text = await f.text();
    this.lastModified = f.lastModified;
    if (!text.trim()) { this.state = 'ok'; await this.writeNow({ force: true }); return; }
    let data = null;
    try { data = normData(JSON.parse(text)); } catch (e) { data = null; }
    if (!data) { this.state = 'error'; this.error = 'le fichier ne contient pas une sauvegarde valide (rien n\'a été écrasé)'; return; }
    this.state = 'ok';
    if (sameTasks(data.tasks, state.tasks)) { this.lastWrite = data.savedAt; return; }
    lsSet(`${KEY_BACKUP}.fichier`, text);
    lsSet(`${KEY_BACKUP}.navigateur`, serializeCompact());
    const merged = mergeTasks(state.tasks, data.tasks, state.deleted, data.deleted);
    state.deleted = merged.deleted;
    const changedHere = !sameTasks(merged.tasks, state.tasks);
    if (changedHere) {
      const cloudOn = typeof cloud !== 'undefined' && cloud.isOn();
      loadData({ tasks: merged.tasks, settings: data.savedAt > state.savedAt ? data.settings : state.settings, savedAt: 0, deleted: merged.deleted }, 'Fusion avec le fichier', { undoable: !cloudOn });
      persist();
      const bits = [];
      if (merged.added) bits.push(plural(merged.added, 'tâche ajoutée', 'tâches ajoutées'));
      if (merged.updated) bits.push(plural(merged.updated, 'tâche mise à jour', 'tâches mises à jour'));
      if (merged.removed) bits.push(plural(merged.removed, 'tâche supprimée', 'tâches supprimées'));
      toast(`Modifications reprises depuis ${this.handle.name} : ${bits.join(', ') || 'liste mise à jour'}.`, cloudOn ? { duration: 9000 } : { action: 'Annuler', onAction: undo, duration: 9000 });
    }
    if (!sameTasks(merged.tasks, data.tasks)) await this.writeNow({ force: true });
    else this.lastWrite = Date.now();
  },

  schedule() {
    if (this.state !== 'ok' && this.state !== 'error') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.writeNow(); }, 600);
  },
  flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; this.writeNow(); } },

  async writeNow({ force = false } = {}) {
    if (!this.handle) return;
    if (this.writing) { this.again = true; return; }
    this.writing = true;
    try {
      if (!force && this.lastModified) {
        // le fichier a-t-il été modifié ailleurs depuis notre dernière lecture ou écriture ?
        const f = await this.handle.getFile();
        if (f.lastModified !== this.lastModified) { this.writing = false; await this.reconcile(); renderStatus(); return; }
      }
      const w = await this.handle.createWritable();
      await w.write(serialize());
      await w.close();
      this.lastWrite = Date.now();
      try { this.lastModified = (await this.handle.getFile()).lastModified; } catch (e) { /* ignore */ }
      this.state = 'ok'; this.error = '';
    } catch (e) {
      console.warn('Écriture du fichier', e);
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { this.state = 'permission'; this.armAutoReconnect(); }
      else {
        this.state = 'error'; this.error = errText(e);
        clearTimeout(this.retry);
        this.retry = setTimeout(() => { if (this.state === 'error') this.writeNow(); }, 5000); // fichier momentanément verrouillé par OneDrive, etc.
      }
    } finally {
      this.writing = false;
      renderStatus();
      if (this.again) { this.again = false; this.writeNow(); }
    }
  },

  /* Au retour sur la fenêtre : le fichier a-t-il été modifié ailleurs (autre PC via OneDrive) ? */
  async checkExternal() {
    if (this.state !== 'ok' || this.writing) return;
    if (this.timer) { this.flush(); return; } // writeNow vérifie lui-même le fichier avant d'écrire
    try {
      const f = await this.handle.getFile();
      if (f.lastModified !== this.lastModified) await this.reconcile();
    } catch (e) { /* fichier momentanément indisponible */ }
    renderStatus();
  },
};
function pickerError(e, what) {
  if (e && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) {
    return 'Votre poste bloque l\'écriture de fichiers depuis le navigateur. Vos tâches restent enregistrées dans Chrome ; utilisez l\'export JSON de temps en temps pour en garder une copie.';
  }
  return `Impossible de ${what} : ${errText(e)}`;
}
function sameTasks(a, b) {
  if (a.length !== b.length) return false;
  const key = (l) => JSON.stringify(l.slice().sort((x, y) => (x.id < y.id ? -1 : 1)));
  return key(a) === key(b);
}
/* Fusion tâche par tâche : la version modifiée le plus récemment l'emporte ; aucune tâche n'est perdue. */
function mergeTasks(mine, theirs, delMine = {}, delTheirs = {}) {
  const map = new Map(mine.map((t) => [t.id, JSON.parse(JSON.stringify(t))]));
  let added = 0, updated = 0, removed = 0;
  for (const t of theirs) {
    const m = map.get(t.id);
    if (!m) {
      if (delMine[t.id] && delMine[t.id] >= t.updatedAt) continue; // supprimée ici après sa dernière modification là-bas
      map.set(t.id, JSON.parse(JSON.stringify(t))); added++;
    } else if (t.updatedAt > m.updatedAt && JSON.stringify(t) !== JSON.stringify(m)) { map.set(t.id, JSON.parse(JSON.stringify(t))); updated++; }
  }
  for (const [id, at] of Object.entries(delTheirs)) {
    const m = map.get(id);
    if (m && at >= m.updatedAt && !theirs.some((t) => t.id === id)) { map.delete(id); removed++; }
  }
  // un rappel déjà traité d'un côté reste traité après fusion (le déclenchement ne change pas updatedAt)
  const byIdMine = new Map(mine.map((t) => [t.id, t])), byIdTheirs = new Map(theirs.map((t) => [t.id, t]));
  for (const [id, t] of map) {
    const x = byIdMine.get(id), y = byIdTheirs.get(id);
    if (!t.remind || !x || !y || !x.remind || !y.remind) continue;
    if (x.remind.date !== y.remind.date || x.remind.time !== y.remind.time) continue;
    const handled = (r) => r.ack && !r.snooze;
    const sn = Math.max(x.remind.snooze || 0, y.remind.snooze || 0);
    t.remind.fired = x.remind.fired || y.remind.fired;
    t.remind.firedAt = Math.max(x.remind.firedAt || 0, y.remind.firedAt || 0) || null;
    if (handled(x.remind) || handled(y.remind)) Object.assign(t.remind, { ack: true, snooze: null }); // traité d'un côté
    else if (sn) Object.assign(t.remind, { ack: false, snooze: sn }); // reporté : le report le plus tardif
    else t.remind.ack = false;
  }
  const deleted = { ...delTheirs, ...delMine };
  for (const id of map.keys()) delete deleted[id];
  return { tasks: Array.from(map.values()), added, updated, removed, deleted };
}
function errText(e) {
  if (!e) return 'erreur inconnue';
  if (e.name === 'NotFoundError') return 'le fichier est introuvable (déplacé ou supprimé ?)';
  if (e.name === 'NoModificationAllowedError') return 'le fichier est verrouillé ou en lecture seule';
  if (e.name === 'QuotaExceededError') return 'espace disque insuffisant';
  return e.message || String(e);
}
function loadData(data, label, { undoable = true } = {}) {
  const before = JSON.stringify(state.tasks);
  if (undoable) { ui.undo.push({ tasks: before, label, sel: ui.selectedId }); ui.redo = []; }
  state.tasks = data.tasks;
  if (data.deleted) state.deleted = { ...data.deleted };
  state.settings = { ...state.settings, ...data.settings };
  if (data.settingsAt) state.settingsAt = Math.max(data.settingsAt, state.settingsAt || 0);
  state.savedAt = Math.max(data.savedAt || 0, state.savedAt);
  applyTheme();
  saveLocal();
  if (!byId(ui.selectedId)) ui.selectedId = null;
  render();
  if (typeof reminders !== 'undefined') reminders.refresh();
}

/* ---------- Export, import ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportJson() {
  download(`to-do-list-${todayISO()}.json`, serialize(), 'application/json');
  toast('Export JSON téléchargé.');
}
function exportMarkdown() {
  const L = [];
  L.push(`# ${APP_NAME}, export du ${F_FULL.format(new Date())}`, '');
  const open = openSorted();
  L.push(`## À faire (${open.length})`, '');
  open.forEach((t, i) => {
    const bits = [];
    if (t.due) bits.push(`échéance ${shortDate(t.due)}`);
    if (t.repeat) bits.push(repeatSentence(t.repeat).toLowerCase());
    if (t.matrix.important !== null) bits.push(QUADS[quadrantOf(t)].title.toLowerCase());
    L.push(`${i + 1}. ${t.title || 'Sans titre'}${bits.length ? ` (${bits.join(', ')})` : ''}`);
    if (remindNext(t)) L.push(`    (rappel ${fmtWhenLong(remindNext(t))})`);
    for (const s of t.steps) L.push(`    - [${s.done ? 'x' : ' '}] ${s.text}`);
    if (t.notes.trim()) for (const line of t.notes.trim().split(/\r?\n/)) L.push(`    > ${line}`);
  });
  const done = doneSorted();
  L.push('', `## Terminées (${done.length})`, '');
  for (const t of done) L.push(`- [x] ${t.title || 'Sans titre'} (terminée le ${shortDate(dayOfMs(t.doneAt))})`);
  download(`to-do-list-${todayISO()}.md`, `${L.join('\n')}\n`, 'text/markdown');
  toast('Export texte téléchargé.');
}
async function importFile(file) {
  let data = null;
  try { data = normData(JSON.parse(await file.text())); } catch (e) { data = null; }
  if (!data) { toast(`« ${file.name} » n'est pas une sauvegarde To do list valide.`); return; }
  const openN = data.tasks.filter((t) => !t.done).length;
  const buttons = [{ id: 'cancel', label: 'Annuler' }];
  if (state.tasks.length) buttons.push({ id: 'merge', label: 'Fusionner avec mes tâches' });
  buttons.push({ id: 'replace', label: state.tasks.length ? 'Remplacer mes tâches' : 'Importer', primary: true, danger: !!state.tasks.length });
  const choice = await confirmDialog({
    title: `Importer ${file.name}`,
    text: `Le fichier contient ${plural(data.tasks.length, 'tâche', 'tâches')}, dont ${openN} à faire.${state.tasks.length ? ' Fusionner ajoute les nouvelles tâches et met à jour celles qui existent déjà ; remplacer efface la liste actuelle.' : ''} L'opération peut être annulée avec Ctrl+Z.`,
    buttons,
  });
  if (!choice || choice === 'cancel') return;
  if (choice === 'replace') {
    commit(() => { const prev = state.tasks; state.tasks = keepRemindRuntime(data.tasks, prev); stampDiff(prev, state.tasks); }, { undo: 'Import' });
  } else {
    let added = 0, updated = 0;
    commit(() => {
      const m = mergeTasks(state.tasks, data.tasks, {}, {}); // import explicite : on reprend tout
      state.tasks = m.tasks; added = m.added; updated = m.updated;
    }, { undo: 'Import' });
    toast(`Import terminé : ${plural(added, 'tâche ajoutée', 'tâches ajoutées')}, ${plural(updated, 'mise à jour', 'mises à jour')}.`, { action: 'Annuler', onAction: undo });
    return;
  }
  toast(`${plural(data.tasks.length, 'tâche importée', 'tâches importées')}.`, { action: 'Annuler', onAction: undo });
}
function recapText(ws) {
  const we = addDays(ws, 6);
  const items = state.tasks.filter((t) => t.done && weekStart(dayOfMs(t.doneAt)) === ws).sort((a, b) => a.doneAt - b.doneAt);
  const head = `Semaine ${isoWeek(ws)} (${rangeLabel(ws, we)}) : ${plural(items.length, 'tâche terminée', 'tâches terminées')}`;
  return [head, ...items.map((t) => `- ${t.title || 'Sans titre'}`)].join('\n');
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* repli ci-dessous */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/* ---------- Toasts, dialogues ---------- */
function toast(msg, { action, onAction, duration } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="msg">${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  let timer;
  const close = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), reducedMotion() ? 0 : 200);
  };
  if (action) el.querySelector('button').addEventListener('click', () => { close(); onAction(); });
  els.toasts.appendChild(el);
  while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
  raiseToasts();
  timer = setTimeout(close, duration || (action ? 6500 : 3500));
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
  return close;
}
/* Les toasts passent au premier plan, y compris au-dessus d'une fenêtre de dialogue ouverte. */
function raiseToasts() {
  const c = els.toasts;
  if (typeof c.showPopover !== 'function') return;
  try { if (c.matches(':popover-open')) c.hidePopover(); c.showPopover(); } catch (e) { /* ignore */ }
}
function confirmDialog({ title, text, buttons }) {
  const dlg = $('#dlgConfirm');
  $('#dlgConfirmTitle').textContent = title;
  $('#dlgConfirmText').textContent = text;
  const foot = $('#dlgConfirmBtns');
  foot.innerHTML = buttons.map((b) => `<button type="button" class="btn${b.primary ? ' primary' : ''}${b.danger && !b.primary ? ' dangerBtn' : ''}" data-choice="${b.id}">${esc(b.label)}</button>`).join('');
  return new Promise((resolve) => {
    const done = (v) => { dlg.removeEventListener('close', onClose); foot.removeEventListener('click', onClick); if (dlg.open) dlg.close(); resolve(v); };
    const onClick = (e) => { const b = e.target.closest('[data-choice]'); if (b) done(b.dataset.choice); };
    const onClose = () => done(null);
    foot.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    const primary = foot.querySelector('.primary') || foot.querySelector('button');
    if (primary) primary.focus();
  });
}

/* ---------- Réglages ---------- */
function refreshSettings() {
  const dlg = $('#dlgSettings');
  if (!dlg.open) return;
  const txt = $('#setFileText');
  const btns = $('#setFileBtns');
  const fs = fileSync;
  if (!fs.supported) {
    txt.innerHTML = 'Ce navigateur ne permet pas d\'écrire dans un fichier. Vos tâches sont enregistrées dans le navigateur ; utilisez l\'export JSON pour garder une copie. <strong>Google Chrome</strong> (ou Edge) active la sauvegarde automatique dans un fichier.';
    btns.innerHTML = '';
  } else if (fs.handle) {
    const s = fs.status();
    txt.innerHTML = `Fichier : <strong>${esc(fs.handle.name)}</strong>. ${esc(s.text)}. Chaque modification y est écrite automatiquement, sans rien à faire ; si le fichier a été modifié sur un autre poste, ses changements sont repris.${fs.state === 'permission' ? ' <br>Quand Chrome demande l\'accès au fichier, choisissez <strong>Autoriser à chaque visite</strong> : la sauvegarde reprendra alors toute seule à chaque ouverture.' : ''}`;
    btns.innerHTML = `${fs.state === 'permission' ? `<button type="button" class="btn primary" data-set="reconnect">${icon('link')}Reconnecter</button>` : ''}
      <button type="button" class="btn" data-set="create">${icon('save')}Changer de fichier</button>
      <button type="button" class="btn" data-set="open">${icon('folder')}Ouvrir un autre fichier</button>
      <button type="button" class="btn dangerBtn" data-set="unlink">Délier</button>`;
  } else {
    txt.innerHTML = 'Vos tâches sont enregistrées dans Chrome. Un nettoyage de Chrome ou une réinitialisation du poste peut les effacer : <strong>choisissez une fois un fichier dans votre OneDrive</strong>, il sera ensuite mis à jour tout seul à chaque modification.';
    btns.innerHTML = `<button type="button" class="btn primary" data-set="create">${icon('save')}Créer un fichier de sauvegarde</button>
      <button type="button" class="btn" data-set="open">${icon('folder')}Ouvrir un fichier existant</button>`;
  }
  const snaps = readSnaps();
  $('#snapList').innerHTML = snaps.length
    ? snaps.map((s, i) => {
      const open = (s.tasks || []).filter((t) => !t.done).length;
      return `<li><span class="d">${esc(cap(longDate(s.day)))}${s.day === todayISO() ? ", début de journée" : ''}</span><span class="c">${plural(open, 'à faire', 'à faire')}, ${(s.tasks || []).length} au total</span><button type="button" class="btn" data-snap="${i}">Restaurer</button></li>`;
    }).join('')
    : '<li class="none">Aucun point de restauration pour l\'instant.</li>';
  $('#prefTheme').value = state.settings.theme;
  $('#prefAddTo').value = state.settings.addTo;
  $('#prefHolidays').checked = state.settings.holidays;
  $('#prefUrgentDays').value = String(state.settings.urgentDays);
  $('#prefRemTime').value = state.settings.remindTime;
  $('#prefRemSound').checked = state.settings.remindSound;
  $('#prefRemSticky').checked = state.settings.remindSticky;
  reminders.renderSettings();
  pwa.render();
  renderSyncSettings();
}
function bindSettings() {
  const dlg = $('#dlgSettings');
  $('#btnSettings').addEventListener('click', () => { dlg.showModal(); refreshSettings(); });
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) { dlg.close(); return; } // clic sur le fond
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.set;
    if (act === 'create') await fileSync.createNew();
    else if (act === 'open') await fileSync.openExisting();
    else if (act === 'unlink') await fileSync.unlink();
    else if (act === 'reconnect') await fileSync.reconnect();
    else if ('snap' in b.dataset) {
      const s = readSnaps()[+b.dataset.snap];
      if (!s) return;
      const ok = await confirmDialog({
        title: 'Restaurer ce point ?',
        text: `La liste reviendra à son état du ${longDate(s.day)}. Vous pourrez annuler avec Ctrl+Z.`,
        buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'ok', label: 'Restaurer', primary: true }],
      });
      if (ok !== 'ok') return;
      const data = normData({ tasks: s.tasks });
      commit(() => { const prev = state.tasks; state.tasks = keepRemindRuntime(data.tasks, prev); stampDiff(prev, state.tasks); }, { undo: 'Restauration' });
      dlg.close();
      toast(`Liste restaurée au ${longDate(s.day)}.`, { action: 'Annuler', onAction: undo });
    } else if ('close' in b.dataset) dlg.close();
  });
  $('#btnExportJson').addEventListener('click', exportJson);
  $('#btnExportMd').addEventListener('click', exportMarkdown);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) { dlg.close(); await importFile(f); }
  });
  $('#prefTheme').addEventListener('change', (e) => setSetting('theme', e.target.value));
  $('#prefAddTo').addEventListener('change', (e) => { setSetting('addTo', e.target.value); renderQuickHint(); });
  $('#prefHolidays').addEventListener('change', (e) => setSetting('holidays', e.target.checked));
  $('#prefUrgentDays').addEventListener('change', (e) => setSetting('urgentDays', +e.target.value));
  $('#prefRemTime').addEventListener('change', (e) => { if (isHM(e.target.value)) setSetting('remindTime', e.target.value); });
  $('#prefRemSound').addEventListener('change', (e) => setSetting('remindSound', e.target.checked));
  $('#prefRemSticky').addEventListener('change', (e) => setSetting('remindSticky', e.target.checked));
  $('#setRemBtns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rset]');
    if (!b) return;
    if (b.dataset.rset === 'enable') reminders.askPermission(true);
    else if (b.dataset.rset === 'test') reminders.test();
    else if (b.dataset.rset === 'ics-all') exportIcs(state.tasks.filter((t) => remindNext(t)));
  });
  $('#btnCopyUrl').addEventListener('click', () => copyText(location.href.split('#')[0]).then((ok) => toast(ok ? 'Adresse copiée.' : 'Copie impossible.')));

  const sc = $('#dlgShortcuts');
  $('#btnShortcuts').addEventListener('click', () => sc.showModal());
  sc.addEventListener('click', (e) => { if (e.target === sc || e.target.closest('[data-close]')) sc.close(); });
}

/* ---------- Saisie rapide ---------- */
function renderQuickHint() {
  const v = els.qa.value;
  const hint = $('#qaHint');
  const { due, remind } = parseQuick(v);
  if (due || remind) {
    const bits = [];
    if (due) { const d = dueInfo(due); bits.push(`Échéance : <span class="chip ${d.cls}">${esc(cap(longDate(due)))}</span>`); }
    if (remind) bits.push(`Rappel : <span class="chip rem">${icon('bell')}${esc(fmtWhen(remindMs(remind)))}</span>`);
    hint.innerHTML = bits.join(' ');
    return;
  }
  if (document.activeElement === els.qa) {
    const main = state.settings.addTo === 'top' ? 'en haut' : 'en bas';
    const other = state.settings.addTo === 'top' ? 'en bas' : 'en haut';
    hint.innerHTML = `Entrée ajoute ${main} de la liste, Alt+Entrée ${other}. <code>@demain</code>, <code>@ven</code> ou <code>@25/10</code> fixent une échéance, <code>@14h</code> un rappel.`;
  } else hint.textContent = '';
}
function bindQuickAdd() {
  els.qa.addEventListener('input', renderQuickHint);
  els.qa.addEventListener('focus', renderQuickHint);
  els.qa.addEventListener('blur', () => setTimeout(renderQuickHint, 0));
  $('#quickadd').addEventListener('submit', (e) => e.preventDefault());
  els.qa.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const pref = state.settings.addTo;
      const where = e.altKey ? (pref === 'top' ? 'bottom' : 'top') : pref;
      const raw = els.qa.value;
      const t = addTask(raw, where);
      if (!t) return;
      els.qa.value = '';
      if (!ui.selectedId && !isNarrow()) ui.selectedId = t.id;
      renderQuickHint();
      if (ui.query) { ui.query = ''; els.search.value = ''; }
      let note = '';
      if (ui.view === 'done') ui.view = 'todo';
      else if (ui.view === 'today' && !(t.due && t.due <= todayISO())) note = "Tâche ajoutée dans À faire : elle n'a pas d'échéance aujourd'hui.";
      render({ detail: !els.detail.dataset.id });
      const r = rowEl(t.id);
      if (r) { r.scrollIntoView({ block: 'nearest' }); if (!reducedMotion()) { r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1400); } }
      if (note) toast(note);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (els.qa.value) { els.qa.value = ''; renderQuickHint(); } else { els.qa.blur(); focusSelectionHost(); }
    } else if (e.key === 'ArrowDown' && !els.qa.value) {
      e.preventDefault();
      if (!byId(ui.selectedId) || !navOrder().includes(ui.selectedId)) selectIndex(0);
      focusSelectionHost();
    }
  });
}

/* ---------- Recherche ---------- */
function bindSearch() {
  const run = debounce(() => { render({ detail: false }); }, 90);
  els.search.addEventListener('input', () => { ui.query = els.search.value; run(); });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (els.search.value) { els.search.value = ''; ui.query = ''; render({ detail: false }); }
      else { els.search.blur(); focusSelectionHost(); }
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      run.flush();
      const ids = navOrder();
      if (ids.length) { select(ids[0], { open: e.key === 'Enter' }); if (e.key !== 'Enter') focusSelectionHost(); }
    }
  });
}

/* ---------- Liste : événements ---------- */
function bindList() {
  els.list.addEventListener('pointerdown', onListPointerDown);
  els.list.addEventListener('click', (e) => {
    if (ui.justDragged) return;
    if (e.target.closest('[data-act="open-file"]')) { fileSync.openExisting(); return; }
    const tog = e.target.closest('[data-toggle]');
    if (tog) { setSetting('doneTodayOpen', !state.settings.doneTodayOpen); return; }
    const rec = e.target.closest('[data-recap]');
    if (rec) { copyText(recapText(rec.dataset.recap)).then((ok) => toast(ok ? 'Récapitulatif copié. Collez-le dans un mail ou dans Teams.' : 'Copie impossible dans ce navigateur.')); return; }
    if (e.target.closest('.check')) return;
    const row = e.target.closest('.row');
    if (row) select(row.dataset.id, { open: true, scroll: false });
  });
  els.list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('.check')) return;
    focusTitle();
  });
  els.list.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    const row = cb.closest('.row');
    if (!row) return;
    toggleFromList(row.dataset.id, cb.checked, row);
  });
}
/* Cocher depuis la liste : petite animation, puis la tâche quitte la liste. */
function toggleFromList(id, checked, row) {
  const pend = ui.pendingComplete.get(id);
  if (pend) { // second clic pendant l'animation : on annule
    clearTimeout(pend);
    ui.pendingComplete.delete(id);
    if (row) { row.classList.remove('completing', 'leaving'); const cb = row.querySelector('input[type="checkbox"]'); if (cb) cb.checked = false; }
    return;
  }
  if (!checked) { setDone(id, false); return; }
  if (reducedMotion() || !row) { setDone(id, true, { advance: true }); return; }
  row.classList.add('completing');
  const cb = row.querySelector('input[type="checkbox"]');
  if (cb) cb.checked = true;
  const timer = setTimeout(() => {
    row.classList.add('leaving');
    ui.pendingComplete.set(id, setTimeout(() => {
      ui.pendingComplete.delete(id);
      setDone(id, true, { advance: true });
    }, 230));
  }, 380);
  ui.pendingComplete.set(id, timer);
}
function focusTitle() {
  if (!byId(ui.selectedId)) return;
  if (overlayMode()) openOverlay();
  const ta = $('#dTitle', els.detail);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function setView(v) {
  if (ui.query) { ui.query = ''; els.search.value = ''; }
  if (els.app.classList.contains('detailOpen')) closeOverlay();
  ui.view = v;
  render({ detail: false });
  const ids = navOrder();
  if (!ids.includes(ui.selectedId)) { if (!overlayMode()) selectIndex(0, { quiet: true }); else { ui.selectedId = null; renderDetail(); } }
  els.scroll.scrollTop = 0;
  els.matrix.scrollTop = 0;
}

/* La recherche ferme d'abord le panneau latéral (sinon le reste de l'application est inerte). */
function openSearch() {
  if (els.app.classList.contains('detailOpen') && overlayMode()) closeOverlay({ quiet: true });
  els.search.focus(); els.search.select();
}

/* ---------- Clavier global ---------- */
function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
  return false;
}
function onKey(e) {
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const typing = isTyping(e.target);
  const k = e.key;

  if (ctrl && !e.altKey && (k === 'f' || k === 'F')) { e.preventDefault(); openSearch(); return; }
  if (ctrl && !typing && !e.altKey) {
    if ((k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey)) { e.preventDefault(); redo(); return; }
  }
  if (typing || ctrl) return;
  if (els.detail.contains(e.target) && k !== 'Escape') return;
  if (els.rcards.contains(e.target)) {
    if (k === 'Escape') { const c = e.target.closest('.rcard'); if (c) { e.preventDefault(); reminders.act(c.dataset.id, 'ok'); } }
    return;
  }

  const onButton = e.target.closest && e.target.closest('button, a, summary');
  const digit = { Digit1: 'todo', Numpad1: 'todo', Digit2: 'today', Numpad2: 'today', Digit3: 'matrix', Numpad3: 'matrix', Digit4: 'done', Numpad4: 'done' }[e.code];
  if (digit && !e.altKey && (e.code.startsWith('Digit') || /^\d$/.test(k))) { e.preventDefault(); setView(digit); return; }

  if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    e.preventDefault();
    if (!ui.selectedId) return;
    moveTask(ui.selectedId, e.shiftKey ? (k === 'ArrowUp' ? 'top' : 'bottom') : (k === 'ArrowUp' ? 'up' : 'down'));
    return;
  }
  if (e.altKey) return;

  switch (k) {
    case 'n': case 'N': case 'a': case 'A':
      e.preventDefault(); els.qa.focus(); return;
    case '/':
      e.preventDefault(); openSearch(); return;
    case '?':
      e.preventDefault(); $('#dlgShortcuts').showModal(); return;
    case 'ArrowDown': case 'j': case 'J':
      e.preventDefault(); if (overlayMode() && els.app.classList.contains('detailOpen')) return; moveSelection(1); focusSelectionHost(); return;
    case 'ArrowUp': case 'k': case 'K':
      e.preventDefault(); if (overlayMode() && els.app.classList.contains('detailOpen')) return; moveSelection(-1); focusSelectionHost(); return;
    case 'Home':
      e.preventDefault(); selectIndex(0); focusSelectionHost(); return;
    case 'End':
      e.preventDefault(); selectIndex(navOrder().length - 1); focusSelectionHost(); return;
    case 'Enter':
      if (onButton || e.target.tagName === 'INPUT') return;
      e.preventDefault(); focusTitle(); return;
    case ' ': case 'x': case 'X': {
      if (k === ' ' && (onButton || e.target.tagName === 'INPUT')) return;
      const t = byId(ui.selectedId);
      if (!t) return;
      e.preventDefault();
      if (!t.done) toggleFromList(t.id, true, rowEl(t.id)); else setDone(t.id, false);
      return;
    }
    case 'i': case 'I': {
      const t = byId(ui.selectedId);
      if (!t || t.done) return;
      e.preventDefault();
      const v = t.matrix.important !== true;
      commit(() => { t.matrix.important = v; touch(t); }, { undo: v ? 'Marquée importante' : 'Marquée pas importante' });
      toast(`${v ? 'Importante' : 'Pas importante'} : ${QUADS[quadrantOf(t)].title.toLowerCase()}.`);
      return;
    }
    case 'u': case 'U': {
      const t = byId(ui.selectedId);
      if (!t || t.done) return;
      e.preventDefault();
      const a = autoUrgent(t);
      const next = t.matrix.urgent === null ? !a : null; // automatique → forcé à l'inverse → automatique
      commit(() => { t.matrix.urgent = next; touch(t); }, { undo: 'Urgence modifiée' });
      toast(next === null ? `Urgence automatique : ${a ? 'urgente' : 'pas urgente'} selon l'échéance.` : (next ? 'Forcée urgente.' : 'Forcée pas urgente.'));
      return;
    }
    case 'Delete':
      if (!ui.selectedId) return;
      e.preventDefault(); deleteTask(ui.selectedId); return;
    case 'Escape':
      if (overlayMode() && els.app.classList.contains('detailOpen')) { e.preventDefault(); closeOverlay(); return; }
      if (ui.query) { e.preventDefault(); ui.query = ''; els.search.value = ''; render({ detail: false }); }
      return;
    default:
  }
}

{{QR_JS}}
/* =====================================================================
   Synchronisation entre appareils, chiffrée de bout en bout
   Les appareils sont jumelés par un « code de synchronisation » affiché en QR code
   (pas d'e-mail, pas de mot de passe). Du code, chaque appareil dérive :
     - une clé de chiffrement (AES-GCM 256), qui ne quitte jamais l'appareil ;
     - une clé d'accès, envoyée au serveur, qui n'en garde que l'empreinte.
   Le serveur (Supabase) ne reçoit que du contenu chiffré.
   ===================================================================== */
const CLOUD_URL = '{{CLOUD_URL}}';
const CLOUD_KEY = '{{CLOUD_KEY}}';
const KEY_CLOUD = 'odj.cloud.v2';
const SETTINGS_ITEM = '__settings';
const SYNCED_SETTINGS = ['addTo', 'holidays', 'urgentDays', 'remindTime'];
const INITIAL_HASH = typeof location !== 'undefined' ? location.hash : '';
const enc8 = new TextEncoder(), dec8 = new TextDecoder();
const b64e = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64urlToBytes = (s) => b64d(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const hexOf = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');

/* ---------- Code de synchronisation : 19 caractères aléatoires + 1 de contrôle (95 bits) ---------- */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base 32 de Crockford : pas de I, L, O, U
const syncCode = {
  check(body) { let s = 0; for (let i = 0; i < body.length; i++) s += (2 * i + 1) * CODE_ALPHABET.indexOf(body[i]); return CODE_ALPHABET[s % 32]; },
  create() {
    const r = crypto.getRandomValues(new Uint8Array(19));
    const body = Array.from(r, (x) => CODE_ALPHABET[x & 31]).join('');
    return body + this.check(body);
  },
  /* Saisie tolérante : minuscules, espaces, tirets ; O lu comme 0, I et L comme 1. */
  normalize(s) {
    return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  },
  valid(c) { return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(c) && this.check(c.slice(0, 19)) === c[19]; },
  format(c) { return c.match(/.{1,5}/g).join('-'); },
  async keys(code) {
    const base = await crypto.subtle.importKey('raw', enc8.encode(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const salt = enc8.encode('to-do-list/sync/v2');
    const access = hexOf(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc8.encode('acces') }, base, 256));
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc8.encode('chiffrement') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { access, key };
  },
};
/* Code de connexion à usage unique (QR code) : 12 caractères aléatoires + 1 de contrôle (60 bits),
   valable 10 minutes. Il ne donne pas accès à la liste : il permet seulement de récupérer, une fois,
   le code de synchronisation déposé chiffré par l'appareil qui affiche le QR code. */
const pairCode = {
  create() {
    const r = crypto.getRandomValues(new Uint8Array(12));
    const body = Array.from(r, (x) => CODE_ALPHABET[x & 31]).join('');
    return body + syncCode.check(body);
  },
  valid(c) { return /^[0-9A-HJKMNP-TV-Z]{13}$/.test(c) && syncCode.check(c.slice(0, 12)) === c[12]; },
  format(c) { return c.match(/.{1,4}/g).join('-'); },
  async keys(token) {
    const base = await crypto.subtle.importKey('raw', enc8.encode(token), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const salt = enc8.encode('to-do-list/jumelage/v1');
    const id = hexOf(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc8.encode('id') }, base, 256));
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc8.encode('cle') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { id, key };
  },
};
function appBaseUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function pairUrl(token) { return `${appBaseUrl()}#jumelage=${token}`; }
/* Texte scanné ou saisi : lien de CETTE application uniquement, ou code seul.
   → { kind: 'token', v } (QR code à usage unique) | { kind: 'code', v } (code de secours) | null */
function parsePairing(text) {
  const t = String(text || '').trim();
  if (t.length > 300) return null;
  let raw = t;
  if (/^https?:/i.test(t)) {
    let u; try { u = new URL(t); } catch (e) { return null; }
    if (u.origin + u.pathname.replace(/index\.html$/, '') !== appBaseUrl()) return null; // lien d'un autre site : ignoré
    const m = u.hash.match(/^#(jumelage|lien)=([0-9A-Za-z-]{13,30})$/);
    if (!m) return null;
    raw = m[2];
  } else if (/[#=]/.test(t)) {
    const m = t.match(/^#?(jumelage|lien)=([0-9A-Za-z-]{13,30})$/);
    if (!m) return null;
    raw = m[2];
  }
  const c = syncCode.normalize(raw);
  if (pairCode.valid(c)) return { kind: 'token', v: c };
  if (syncCode.valid(c)) return { kind: 'code', v: c };
  return null;
}

/* Données associées au chiffrement : lient le contenu à son identifiant, à sa date et à sa nature
   (une suppression ou une date ne peuvent pas être fabriquées sans la clé). */
const aadItem = (id, at, del = false) => `${id}|${at}${del ? '|del' : ''}`;
const vault = {
  async encrypt(key, value, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc8.encode(aad) }, key, enc8.encode(JSON.stringify(value)));
    return `v1.${b64e(iv)}.${b64e(ct)}`;
  },
  async decrypt(key, text, aad) {
    const [v, iv, ct] = String(text).split('.');
    if (v !== 'v1' || !iv || !ct) throw new Error('format inconnu');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv), additionalData: enc8.encode(aad) }, key, b64d(ct));
    return JSON.parse(dec8.decode(pt));
  },
};

const cloud = {
  enabled: !!CLOUD_URL && !CLOUD_URL.startsWith('{{') && pwaWeb(),
  st: null,          // état persistant : code, curseur, ce qui a déjà été envoyé
  key: null,         // clé de chiffrement (CryptoKey non exportable), aussi gardée dans IndexedDB pour les notifications
  access: null,      // clé d'accès au serveur (dérivée du code)
  status: 'off',     // off | ready | syncing | offline | error | unpaired
  error: '',
  running: false, again: false, timer: null, backoff: 0, lastOk: 0,

  blank() { return { pushed: {}, delPushed: {} }; },
  load() {
    try { this.st = JSON.parse(lsGet(KEY_CLOUD) || 'null'); } catch (e) { this.st = null; }
    if (!this.st || typeof this.st !== 'object') this.st = this.blank();
    this.st.pushed ||= {}; this.st.delPushed ||= {};
  },
  save() { lsSet(KEY_CLOUD, JSON.stringify(this.st)); },
  isOn() { return this.enabled && !!(this.st && this.st.code) && !this.st.dead; },
  isDead() { return this.enabled && !!(this.st && this.st.code && this.st.dead); },

  async init() {
    if (!this.enabled) return;
    this.load();
    if (this.st.code) await this.applyCode();
    if (this.isDead()) this.status = 'unpaired';
    renderStatus();
    if (this.isOn()) { this.status = 'ready'; this.bind(); this.sync(); }
  },
  /* Dérive les clés du code enregistré (et les met à disposition des notifications). */
  async applyCode() {
    const { access, key } = await syncCode.keys(this.st.code);
    this.access = access; this.key = key;
    try { await idb.set('cryptoKey', key); } catch (e) { /* notifications : texte générique */ }
  },
  bound: false,
  bind() {
    if (this.bound) return;
    this.bound = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync(); });
    window.addEventListener('focus', () => this.sync());
    window.addEventListener('online', () => { this.backoff = 0; this.sync(); });
    setInterval(() => { if (document.visibilityState === 'visible') this.sync(); }, 60000);
  },
  /* Appelé après chaque modification locale : envoi groupé 1,5 s plus tard. */
  schedule() {
    if (!this.key || !this.isOn()) return;
    if (this.running) { this.again = true; return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 1500);
  },

  /* ---------- appels au serveur (fonctions de la base uniquement) ---------- */
  async rpc(name, args = {}) {
    const headers = { apikey: CLOUD_KEY, 'Content-Type': 'application/json' };
    if (!CLOUD_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${CLOUD_KEY}`; // ancienne clé « anon » (JWT)
    let r;
    try {
      r = await fetch(`${CLOUD_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), cache: 'no-store' });
    } catch (e) { const err = new Error('réseau'); err.offline = true; throw err; }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      const err = new Error((data && (data.message || data.msg || data.error)) || `erreur ${r.status}`);
      err.status = r.status; err.code = data && data.code;
      if (/compte inconnu/.test(err.message)) err.unknown = true;
      throw err;
    }
    return data;
  },
  call(name, args = {}, K = null) { return this.rpc(name, { p_key: (K || this).access, ...args }); },

  /* ---------- jumelage ---------- */
  /* Première synchronisation : cet appareil crée le code. */
  async create() {
    const code = syncCode.create();
    const { access } = await syncCode.keys(code);
    await this.rpc('create_account', { p_key: access });
    await this.adopt(code);
    return code;
  },
  /* Rejoindre une liste existante avec son code (QR scanné ou saisi). */
  async join(code) {
    const { access } = await syncCode.keys(code);
    try {
      await this.rpc('account_info', { p_key: access }); // vérifie le code sans rien télécharger
    } catch (e) {
      if (e.unknown) { const err = new Error('Ce code n\'est pas (ou plus) valable. Affichez le QR code à jour sur un appareil déjà connecté.'); err.badCode = true; throw err; }
      throw e;
    }
    await this.adopt(code);
  },
  async adopt(code) {
    clearTimeout(this.timer);
    await withLock('odj-cloud-sync', async () => { await this._adopt(code); });
    await this.sync({ first: true });
  },
  async _adopt(code) {
    const prev = this.st || this.blank();
    if (prev.code && prev.code !== code && prev.pushWanted && !prev.dead) { try { await this.unsubscribePush(); } catch (e) { /* hors ligne */ } }
    this.st = { ...this.blank(), code, label: prev.label || deviceLabel(), pushWanted: prev.pushWanted, endpoint: prev.endpoint };
    this.save();
    await this.applyCode();
    this.status = 'ready';
    this.bind();
  },
  /* QR code à usage unique : le code de synchronisation est déposé chiffré pour 10 minutes. */
  async offerPairing() {
    const K = { access: this.access }, code = this.st.code;
    const token = pairCode.create();
    const { id, key } = await pairCode.keys(token);
    const blob = await vault.encrypt(key, { code }, 'jumelage');
    await this.call('pair_offer', { p_id: id, p_blob: blob }, K);
    return { token, id, expires: Date.now() + 10 * 60000 - 5000 };
  },
  pairStatus(id) { return this.call('pair_status', { p_id: id }); },
  cancelPairing(id) { return this.isOn() ? this.call('pair_cancel', { p_id: id }) : Promise.resolve(); },
  async takePairing(token) {
    const { id, key } = await pairCode.keys(token);
    const blob = await this.rpc('pair_take', { p_id: id });
    const bad = () => { const err = new Error('Ce QR code a expiré ou a déjà servi. Affichez-en un nouveau sur l\'autre appareil (Réglages, puis Afficher le QR code).'); err.badCode = true; return err; };
    if (!blob || typeof blob !== 'string') throw bad();
    let v; try { v = await vault.decrypt(key, blob, 'jumelage'); } catch (e) { throw bad(); }
    const c = syncCode.normalize(v && v.code);
    if (!syncCode.valid(c)) throw bad();
    return c;
  },
  /* Ce que contient une liste avant de la rejoindre (création, nombre de tâches, appareils). */
  async info(code) {
    const { access } = await syncCode.keys(code);
    try { return await this.rpc('account_info', { p_key: access }); } catch (e) {
      if (e.unknown) { const err = new Error('Ce code n\'est pas (ou plus) valable. Affichez le QR code à jour sur un appareil déjà connecté.'); err.badCode = true; throw err; }
      throw e;
    }
  },
  /* Nouveau code : les autres appareils sont déconnectés (appareil perdu, code partagé par erreur). */
  async changeCode() {
    clearTimeout(this.timer);
    this.running = true;
    try {
      return await withLock('odj-cloud-sync', async () => {
        await this._sync({ retireOk: false }); // récupère d'abord les dernières modifications
        if (this.status !== 'ready') throw new Error(this.status === 'offline' ? 'Pas de connexion au serveur : réessayez une fois en ligne.' : this.error || 'Synchronisation impossible pour le moment.');
        const oldAccess = this.access;
        const code = syncCode.create();
        const { access } = await syncCode.keys(code);
        await this.rpc('create_account', { p_key: access });
        // L'ancien code sera retiré dès que tout aura été envoyé avec le nouveau (réessayé tant que nécessaire).
        const keep = { pushWanted: this.st.pushWanted, label: this.st.label, retire: [...(this.st.retire || []), oldAccess] };
        this.st = { ...this.blank(), code, ...keep };
        this.save();
        await this.applyCode();
        await this._sync();
        return code;
      });
    } finally { this.running = false; if (this.again) { this.again = false; this.schedule(); } }
  },
  /* Retire définitivement les anciens codes (après « Changer de code »). */
  async retireOld(K) {
    const list = (this.st.retire || []).filter((a) => a !== K.access);
    for (const a of list) {
      try { await this.rpc('delete_account', { p_key: a }); } catch (e) { console.warn('Ancien code : nouvel essai à la prochaine synchronisation', e); return; }
      this.st.retire = (this.st.retire || []).filter((x) => x !== a);
      this.save();
    }
  },
  async disconnect() {
    try { await this.unsubscribePush(); } catch (e) { /* hors ligne : tant pis */ }
    this.st = this.blank(); this.save();
    this.key = null; this.access = null;
    idb.del('cryptoKey').catch(() => {});
    this.status = 'off'; renderStatus();
  },
  /* Le code a été changé (ou supprimé) depuis un autre appareil. */
  markDead() {
    this.st.dead = true; this.save();
    this.status = 'unpaired'; this.error = '';
    clearTimeout(this.timer);
    renderStatus(); refreshSettings();
    toast('Le code de synchronisation a été changé sur un autre appareil : scannez le nouveau QR code pour reprendre. Vos tâches restent sur cet appareil.', { duration: 12000 });
  },

  /* ---------- synchronisation ---------- */
  async sync(opts = {}) {
    if (!this.key || !this.isOn()) return;
    if (this.running) { this.again = true; return; }
    clearTimeout(this.timer);
    this.running = true;
    try { await withLock('odj-cloud-sync', () => this._sync(opts)); } finally { this.running = false; if (this.again) { this.again = false; this.schedule(); } }
  },
  async _sync({ first = false, retireOk = true } = {}) {
    // une autre fenêtre a pu avancer (ou changer de code) : on repart de l'état partagé
    try {
      const fresh = JSON.parse(lsGet(KEY_CLOUD) || 'null');
      if (fresh && fresh.code) {
        const codeChanged = fresh.code !== this.st.code;
        this.st = { ...this.st, ...fresh }; this.st.pushed ||= {}; this.st.delPushed ||= {};
        if (codeChanged) await this.applyCode();
      } else if (fresh && !fresh.code && this.st.code) { this.st = this.blank(); this.key = null; this.status = 'off'; renderStatus(); return; }
    } catch (e) { /* ignore */ }
    if (!this.key || !this.isOn()) return;
    // clés figées pour toute la durée de la synchronisation (un changement de code ailleurs ne les mélange pas)
    const K = { code: this.st.code, access: this.access, key: this.key };
    const prev = this.status;
    this.status = 'syncing'; if (prev !== 'ready') renderStatus();
    try {
      await this.pull(K);
      await this.push(K);
      await this.pushReminders(K);
      await this.ensurePush();
      if (retireOk) await this.retireOld(K);
      this.status = 'ready'; this.error = ''; this.backoff = 0; this.lastOk = Date.now();
      this.st.lastSync = this.lastOk; this.save();
      if (first && !$('#dlgSync').open) toast('Synchronisation active : vos tâches sont maintenant sur tous vos appareils connectés.', { duration: 7000 });
    } catch (e) {
      console.warn('Synchronisation', e);
      if (e.unknown) {
        if (this.st.code !== K.code) { this.schedule(); return; } // le code a changé pendant la synchronisation : on recommence
        this.markDead(); return;
      }
      if (e.offline) this.status = 'offline';
      else { this.status = 'error'; this.error = e.message || String(e); }
      this.backoff = Math.min(300000, (this.backoff || 5000) * 2);
      clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), this.backoff);
    } finally {
      renderStatus(); refreshSettings();
    }
  },
  async pull(K) {
    // léger recouvrement pour ne rien rater (écritures simultanées) ; la fusion rend les doublons sans effet
    const since = this.st.cursor ? new Date(Date.parse(this.st.cursor) - 30000).toISOString() : null;
    const rows = [];
    let page = await this.call('pull_items', since ? { p_since: since, p_after_id: '' } : {}, K);
    rows.push(...page);
    for (let n = 1; Array.isArray(page) && page.length === 500 && n < 40; n++) {
      const last = page[page.length - 1];
      page = await this.call('pull_items', { p_since: last.modified_at, p_after_id: last.id }, K);
      if (!Array.isArray(page) || !page.length) break;
      const end = page[page.length - 1];
      if (end.modified_at === last.modified_at && end.id === last.id) break; // le serveur ne progresse plus
      rows.push(...page);
    }
    if (!rows.length) return;
    const tasks = [], deleted = {};
    let settings = null, maxMod = this.st.cursor || '';
    for (const r of rows) {
      if (!maxMod || Date.parse(r.modified_at) > Date.parse(maxMod)) maxMod = r.modified_at;
      const at = Number(r.updated_at);
      if (r.deleted) {
        // une suppression n'est prise en compte que si elle a été chiffrée par un appareil de la liste
        try { await vault.decrypt(K.key, r.data, aadItem(r.id, at, true)); } catch (e) { console.warn('Suppression non authentifiée ignorée', r.id); continue; }
        if (r.id !== SETTINGS_ITEM) deleted[r.id] = at;
        continue;
      }
      let v;
      try { v = await vault.decrypt(K.key, r.data, aadItem(r.id, at)); } catch (e) { console.warn('Élément illisible', r.id); continue; }
      if (r.id === SETTINGS_ITEM) { settings = { at: Number(r.updated_at), v }; continue; }
      const t = normTask(v);
      if (t && t.id === r.id) tasks.push(t);
    }
    // fusion tâche par tâche (même règle que pour le fichier de sauvegarde)
    const m = mergeTasks(state.tasks, tasks, state.deleted, deleted);
    let changed = !sameTasks(m.tasks, state.tasks);
    if (changed) { state.tasks = m.tasks; }
    state.deleted = m.deleted;
    for (const r of rows) {
      if (r.deleted) { if (deleted[r.id] === Number(r.updated_at)) this.st.delPushed[r.id] = Number(r.updated_at); continue; }
      const t = byId(r.id);
      if (t && t.updatedAt === Number(r.updated_at)) this.st.pushed[r.id] = t.updatedAt;
    }
    if (settings && settings.at > (state.settingsAt || 0)) {
      for (const k of SYNCED_SETTINGS) if (k in settings.v) state.settings[k] = settings.v[k];
      state.settings = normData({ tasks: [], settings: state.settings }).settings;
      state.settingsAt = settings.at; this.st.settingsPushed = settings.at;
      changed = true;
    }
    this.st.cursor = maxMod;
    this.save();
    if (changed) {
      if (ui.undo.length || ui.redo.length) { ui.undo = []; ui.redo = []; ui.coalesceKey = null; }
      state.savedAt = Math.max(Date.now(), state.savedAt + 1);
      saveLocal(); fileSync.schedule();
      if (!byId(ui.selectedId)) ui.selectedId = null;
      cancelPendingCompletes();
      render({ detail: !els.detail.contains(document.activeElement) });
      reminders.refresh();
    }
  },
  async push(K) {
    const rows = [];
    for (const t of state.tasks) {
      if (this.st.pushed[t.id] === t.updatedAt) continue;
      rows.push({ id: t.id, updated_at: t.updatedAt, deleted: false, data: await vault.encrypt(K.key, t, aadItem(t.id, t.updatedAt)) });
    }
    for (const [id, at] of Object.entries(state.deleted)) {
      if (this.st.delPushed[id] === at) continue;
      rows.push({ id, updated_at: at, deleted: true, data: await vault.encrypt(K.key, { deleted: true }, aadItem(id, at, true)) });
    }
    const sAt = state.settingsAt || 0;
    if (sAt && this.st.settingsPushed !== sAt) {
      const v = {}; for (const k of SYNCED_SETTINGS) v[k] = state.settings[k];
      rows.push({ id: SETTINGS_ITEM, updated_at: sAt, deleted: false, data: await vault.encrypt(K.key, v, aadItem(SETTINGS_ITEM, sAt)) });
    }
    const rejected = [];
    const send = async (batch) => {
      const res = await this.call('push_items', { p_rows: batch }, K);
      const rej = new Set((res && res.rejected) || []);
      for (const r of batch) {
        if (rej.has(r.id)) { rejected.push(r.id); continue; }
        if (r.id === SETTINGS_ITEM) this.st.settingsPushed = r.updated_at;
        else if (r.deleted) this.st.delPushed[r.id] = r.updated_at;
        else this.st.pushed[r.id] = r.updated_at;
      }
      this.save();
    };
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      try { await send(batch); } catch (e) {
        if (e.unknown || e.offline || !(e.status >= 400 && e.status < 500) || batch.length === 1) throw e;
        // une ligne refusée (trop volumineuse…) ne doit pas bloquer les autres
        for (const r of batch) { try { await send([r]); } catch (e2) { if (e2.unknown || e2.offline) throw e2; console.warn('Élément non envoyé', r.id, e2); this.skipped = r.id; } }
      }
    }
    if (rejected.length) await this.fetchServerVersions(rejected, K);
  },
  /* Le serveur avait une version plus récente (autre appareil, horloge différente) : fusion avec les
     mêmes règles que la lecture normale. Seuls les éléments demandés, authentiques et plus récents
     sont pris ; une version ancienne rejouée par le serveur est ignorée. */
  async fetchServerVersions(ids, K) {
    const asked = new Set(ids.filter((id) => id !== SETTINGS_ITEM));
    if (ids.includes(SETTINGS_ITEM)) this.st.cursor = null; // relire les réglages au prochain passage
    const list = [...asked];
    for (let i = 0; i < list.length; i += 100) {
      const rows = await this.call('get_items', { p_ids: list.slice(i, i + 100) }, K);
      const tasks = [], deleted = {};
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || !asked.has(r.id)) continue;
        const at = Number(r.updated_at);
        if (!Number.isFinite(at)) continue;
        if (r.deleted) {
          try { await vault.decrypt(K.key, r.data, aadItem(r.id, at, true)); } catch (e) { continue; }
          deleted[r.id] = at;
          continue;
        }
        let t;
        try { t = normTask(await vault.decrypt(K.key, r.data, aadItem(r.id, at))); } catch (e) { continue; }
        if (t && t.id === r.id && t.updatedAt === at) tasks.push(t);
      }
      const m = mergeTasks(state.tasks, tasks, state.deleted, deleted);
      // même date, contenu différent (deux appareils à la même milliseconde) : la version du serveur fait foi
      for (const t of tasks) {
        const k = m.tasks.findIndex((x) => x.id === t.id);
        if (k >= 0 && m.tasks[k].updatedAt === t.updatedAt && JSON.stringify(m.tasks[k]) !== JSON.stringify(t)) m.tasks[k] = JSON.parse(JSON.stringify(t));
      }
      const changed = !sameTasks(m.tasks, state.tasks);
      if (changed) state.tasks = m.tasks;
      state.deleted = m.deleted;
      // ce que détient le serveur est maintenant connu : pas de nouvel envoi en boucle
      for (const t of tasks) { const l = byId(t.id); if (l && l.updatedAt <= t.updatedAt) this.st.pushed[t.id] = l.updatedAt; }
      for (const [id, at] of Object.entries(deleted)) {
        if (byId(id)) continue;
        if (!state.deleted[id] || state.deleted[id] <= at) state.deleted[id] = at;
        this.st.delPushed[id] = state.deleted[id];
      }
      this.save();
      if (changed) {
        ui.undo = []; ui.redo = []; ui.coalesceKey = null;
        state.savedAt = Math.max(Date.now(), state.savedAt + 1);
        if (!byId(ui.selectedId)) ui.selectedId = null;
        saveLocal(); fileSync.schedule(); render({ detail: !els.detail.contains(document.activeElement) }); reminders.refresh();
      }
    }
  },
  /* Les prochains rappels, pour que le serveur les envoie même appareils éteints. Le texte est chiffré. */
  async pushReminders(K) {
    const list = state.tasks.map((t) => [t, serverFireAt(t)]).filter(([, n]) => n)
      .sort((a, b) => a[1] - b[1]).slice(0, 300);
    const sig = 'v2' + JSON.stringify(list.map(([t, n]) => [t.id, n, t.title, notifBody(t)])); // v2 : heure dans le message chiffré
    if (sig === this.st.remSig) return;
    const rows = [];
    for (const [t, n] of list) rows.push({ task_id: t.id, fire_at: n, payload: await vault.encrypt(K.key, { title: truncate(t.title || 'Rappel', 140), body: truncate(notifBody(t), 240), at: n }, `rem:${t.id}`) });
    await this.call('set_reminders', { p_rows: rows }, K);
    this.st.remSig = sig; this.save();
  },

  /* ---------- notifications sur cet appareil ---------- */
  pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'; },
  needsIosInstall() { return isIos() && !pwa.standalone(); },
  async enablePush() {
    if (this.needsIosInstall()) { toast('Sur iPhone, installez d\'abord l\'application : bouton Partager, puis « Sur l\'écran d\'accueil ». Ouvrez-la depuis l\'icône, puis réactivez les notifications.', { duration: 12000 }); return false; }
    if (!this.pushSupported()) { toast('Ce navigateur ne permet pas les notifications en arrière-plan.'); return false; }
    const p = await Notification.requestPermission(); // appel immédiat, dans le geste de l'utilisateur
    if (p !== 'granted') { toast('Notifications refusées. Elles se réactivent dans les réglages du téléphone ou du navigateur.', { duration: 8000 }); refreshSettings(); return false; }
    let ok = false;
    try { ok = await this.subscribe(); } catch (e) { toast(e.offline ? 'Pas de connexion au serveur : réessayez une fois en ligne.' : `Activation impossible : ${e.message}`); }
    if (ok) { this.st.pushWanted = true; this.save(); toast('Notifications activées sur cet appareil, même application fermée.'); }
    refreshSettings(); reminders.renderSettings();
    return ok;
  },
  async subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const pub = await this.rpc('vapid_public_key', {});
    if (!pub) { toast('Le serveur prépare l\'envoi des notifications (première minute après l\'installation). Réessayez dans un instant.'); return false; }
    let sub = await reg.pushManager.getSubscription();
    if (sub && this.st.vapid && this.st.vapid !== pub) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(pub) });
    const j = sub.toJSON();
    if (this.st.endpoint && this.st.endpoint !== j.endpoint) await this.call('unregister_push', { p_endpoint: this.st.endpoint }).catch(() => {});
    await this.call('register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: this.st.label || deviceLabel() });
    this.st.vapid = pub; this.st.pushAt = Date.now(); this.st.endpoint = j.endpoint; this.save();
    return true;
  },
  async unsubscribePush() {
    if (!this.pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    const endpoints = new Set([sub && sub.endpoint, this.st.endpoint].filter(Boolean));
    if (this.access) for (const ep of endpoints) await this.call('unregister_push', { p_endpoint: ep }).catch(() => {});
    if (sub) await sub.unsubscribe().catch(() => {});
    this.st.pushWanted = false; this.st.endpoint = null; this.save();
  },
  /* Réabonne l'appareil si besoin (abonnement expiré, nouveau code, ou une fois par jour pour rester à jour). */
  async ensurePush() {
    if (!this.st.pushWanted || !this.pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub || sub.endpoint !== this.st.endpoint || Date.now() - (this.st.pushAt || 0) > 86400000) await this.subscribe().catch((e) => { if (e.unknown) throw e; console.warn('Abonnement', e); });
  },
  pushActive() { return !!(this.st && this.st.pushWanted && typeof Notification !== 'undefined' && Notification.permission === 'granted'); },

  statusLine() {
    if (this.isDead()) return { tone: 'warn', icon: 'alert', text: 'Le code de synchronisation a changé : scannez le nouveau QR code.', action: { id: 'sync-scan', label: 'Scanner' } };
    switch (this.status) {
      case 'offline': return { tone: '', icon: 'sync', text: 'Hors ligne : vos modifications seront synchronisées au retour du réseau.', title: 'Vos tâches restent enregistrées sur cet appareil.' };
      case 'error': return { tone: 'err', icon: 'alert', text: `Synchronisation impossible : ${this.error}`, action: { id: 'sync-now', label: 'Réessayer' } };
      default: {
        const at = this.lastOk || this.st.lastSync;
        return { tone: 'ok', icon: 'sync', text: at ? `Synchronisé à ${F_TIME.format(new Date(at))}` : 'Synchronisation…', title: 'Chiffré de bout en bout : le serveur ne peut pas lire vos tâches.' };
      }
    }
  },
};
function pwaWeb() { return /^https?:$/.test(location.protocol); }
/* Heure d'envoi par le serveur : rappel prévu ou reporté, tant qu'il n'a pas été traité (même s'il a déjà
   été affiché sur cet appareil : le téléphone doit le recevoir aussi). */
function serverFireAt(t) {
  if (!t.remind || t.done || t.remind.ack) return null;
  return t.remind.snooze || remindMs(t.remind);
}
/* Verrou partagé entre fenêtres (si le navigateur le permet). */
function withLock(name, fn) {
  if (navigator.locks && navigator.locks.request) return navigator.locks.request(name, fn);
  return fn();
}
function isIos() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || isIos()) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Navigateur';
}

/* ---------- Scanner de QR code (appareil photo, dans l'application) ---------- */
const scanner = {
  stream: null, raf: null, busy: false, detector: null, jsqrLoading: null, gen: 0,
  async start(video, onCode, onState) {
    this.stop();
    const gen = ++this.gen;
    const alive = () => gen === this.gen && video.isConnected;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onState('nocam'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      if (alive()) onState(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nocam');
      return;
    }
    // fenêtre fermée (Échap…) pendant l'ouverture de la caméra : on l'éteint aussitôt
    if (!alive()) { for (const t of stream.getTracks()) t.stop(); return; }
    this.stream = stream;
    video.srcObject = stream;
    video.setAttribute('playsinline', ''); video.muted = true;
    try { await video.play(); } catch (e) { /* lecture automatique : relancée au premier geste */ }
    if (!alive()) return;
    onState('live');
    if (!this.detector && 'BarcodeDetector' in window) {
      try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) this.detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { this.detector = null; }
    }
    if (!this.detector) await this.loadJsqr().catch(() => { if (alive()) onState('nolib'); });
    if (!alive()) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = 0;
    const tick = async (ts) => {
      if (gen !== this.gen || !this.stream) return;
      this.raf = requestAnimationFrame(tick);
      if (this.busy || ts - last < 150 || video.readyState < 2) return;
      last = ts; this.busy = true;
      try {
        let text = null;
        if (this.detector) {
          const codes = await this.detector.detect(video);
          if (codes && codes[0]) text = codes[0].rawValue;
        } else if (self.jsQR) {
          const w = video.videoWidth, h = video.videoHeight;
          const scale = Math.min(1, 720 / Math.max(w, h));
          canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const res = self.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (res) text = res.data;
        }
        if (text && gen === this.gen && this.stream) onCode(text);
      } catch (e) { /* image suivante */ } finally { this.busy = false; }
    };
    this.raf = requestAnimationFrame(tick);
  },
  loadJsqr() {
    if (self.jsQR) return Promise.resolve();
    this.jsqrLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'jsqr.js'; s.async = true;
      s.integrity = '{{JSQR_SRI}}'; s.crossOrigin = 'anonymous'; // empreinte vérifiée par le navigateur
      s.onload = () => (self.jsQR ? resolve() : reject(new Error('jsQR')));
      s.onerror = () => { this.jsqrLoading = null; reject(new Error('jsQR')); };
      document.head.appendChild(s);
    });
    return this.jsqrLoading;
  },
  stop() {
    this.gen++;
    cancelAnimationFrame(this.raf); this.raf = null;
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
  },
};

/* ---------- Fenêtre de synchronisation ---------- */
const syncUi = {
  step: 'start', pending: null, input: null, offer: null, timer: null, gen: 0,
  open(step) {
    const dlg = $('#dlgSync');
    this.step = step || (cloud.isOn() ? 'show' : 'start');
    if (!dlg.open) dlg.showModal(); // ouverte avant le contenu : les étapes asynchrones la voient ouverte
    this.render();
  },
  close() { this.stopTimer(); scanner.stop(); const d = $('#dlgSync'); if (d.open) d.close(); },
  /* Le QR code affiché est annulé dès qu'il quitte l'écran (fenêtre fermée, autre étape). */
  stopTimer() {
    clearInterval(this.timer); this.timer = null;
    const o = this.offer; this.offer = null;
    if (o && !o.done) cloud.cancelPairing(o.id).catch(() => {});
  },
  fail(e) {
    const m = $('#syncMsg');
    let txt = e.message || String(e);
    if (e.offline) txt = 'Pas de connexion au serveur. Vérifiez le réseau, puis réessayez.';
    if (m) { m.textContent = txt; m.hidden = false; }
    this.busy(false);
  },
  busy(on) { for (const b of $$('#dlgSync .btn')) b.disabled = on; const s = $('#syncSpin'); if (s) s.hidden = !on; },
  render() {
    scanner.stop(); this.stopTimer();
    const gen = ++this.gen;
    const body = $('#syncBody');
    const already = cloud.isOn() && this.pending && cloud.st.code !== this.pending;
    const steps = {
      start: `<p class="setText">Retrouvez la même liste sur votre ordinateur et votre téléphone, avec les rappels en notification. Pas d'e-mail ni de mot de passe : les appareils se connectent en scannant un QR code. Vos tâches sont chiffrées sur l'appareil, le serveur ne peut pas les lire.</p>
        <div class="choice">
          <button type="button" class="choiceBtn" data-sync="create">${icon('sync')}<span><strong>Première fois</strong><small>Activer la synchronisation sur cet appareil et afficher le QR code</small></span></button>
          <button type="button" class="choiceBtn" data-sync="scan">${icon('camera')}<span><strong>Un autre appareil est déjà synchronisé</strong><small>Scanner son QR code ou saisir son code</small></span></button>
        </div>`,
      show: cloud.isOn() ? `<div class="pair">
          <div class="qrWrap" id="syncQrWrap"><div class="qr big" id="syncQr" role="img" aria-label="QR code de connexion"></div>
            <div class="qrState" id="qrState"><span class="spin" aria-hidden="true"></span><span>Préparation…</span></div></div>
          <div class="pairText">
            <ol class="steps2">
              <li>Sur l'autre appareil, ouvrez To do list et touchez <strong>Scanner le QR code</strong>.</li>
              <li>Visez ce code. C'est tout.</li>
            </ol>
            <p class="fHint">Application pas encore installée sur le téléphone ? Scannez ce code avec son appareil photo : il ouvre To do list et le connecte.</p>
            <p class="codeLine" id="pairLine" hidden>Ou saisissez : <code class="syncCode" id="pairCodeTxt"></code></p>
            <p class="fHint" id="pairInfo" aria-live="polite">Ce QR code ne sert qu'une fois et expire au bout de 10 minutes.</p>
          </div>
        </div>${pushBlockHTML()}
        <p class="fHint secretLink"><button type="button" class="linkBtn" data-sync="secret">${icon('alert')}Code de secours</button> : pour tout récupérer si vous perdez tous vos appareils.</p>` : '',
      secret: cloud.isOn() ? `<p class="setText">Ce code de 20 caractères donne accès à votre liste <strong>depuis n'importe quel appareil, sans limite de durée</strong>. Notez-le sur papier et rangez-le chez vous : il vous permettra de tout récupérer si vous perdez tous vos appareils en même temps.</p>
        <p class="fHint warnHint">${icon('alert')}Ne le montrez à personne et ne l'envoyez pas par message. Si quelqu'un l'a vu : Réglages, puis <strong>Changer de code</strong>.</p>
        <p class="codeLine"><code class="syncCode masked" id="secretTxt">${esc(syncCode.format(cloud.st.code))}</code>
          <button type="button" class="linkBtn" data-sync="secret-reveal">Afficher</button>
          <button type="button" class="linkBtn" data-sync="copy">${icon('copy')}Copier</button></p>` : '',
      scan: `<div class="scanBox"><video id="scanVideo" playsinline muted autoplay></video><div class="scanFrame" aria-hidden="true"></div><p class="scanState" id="scanState">Activation de l'appareil photo…</p></div>
        <p class="fHint">Sur l'appareil déjà synchronisé : Réglages, puis <strong>Afficher le QR code</strong>. <button type="button" class="linkBtn" data-sync="enter">Saisir le code à la place</button></p>`,
      enter: `<p class="setText">Sur l'appareil déjà synchronisé : Réglages, puis <strong>Afficher le QR code</strong>. Le code à saisir est écrit sous le QR code.</p>
        <label class="fLabel" for="syncCodeInput">Code de connexion</label>
        <input class="field wide codeInput" id="syncCodeInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-X" maxlength="29">
        <p class="fHint">13 caractères, valable 10 minutes. Vous pouvez aussi saisir votre code de secours (20 caractères).</p>
        <p class="fHint warnHint">${icon('alert')}Ne saisissez jamais un code donné par quelqu'un d'autre : il pourrait lire tout ce que vous noterez ici.</p>`,
      confirm: `<p class="setText" id="confirmText">${already
          ? 'Cet appareil est déjà synchronisé avec une autre liste. Le connecter à celle-ci à la place ? Ses tâches actuelles y seront ajoutées.'
          : state.tasks.length ? 'Connecter cet appareil à cette liste ? Les tâches déjà présentes ici y seront ajoutées.' : 'Connecter cet appareil à cette liste ?'}</p>
        <div class="listInfo" id="syncInfo" aria-live="polite"><span class="spin" aria-hidden="true"></span>Vérification…</div>
        <p class="fHint warnHint">${icon('alert')}Si vous n'avez pas créé cette liste vous-même, sur l'un de vos appareils, annulez : son propriétaire pourrait lire tout ce que vous y ajouterez.</p>`,
      ios: `<p class="setText">Pour recevoir les rappels en notification sur iPhone, To do list doit être installée sur l'écran d'accueil :</p>
        <ol class="steps2"><li>Touchez le bouton <strong>Partager</strong> de Safari (le carré avec une flèche vers le haut).</li>
        <li>Choisissez <strong>« Sur l'écran d'accueil »</strong>, puis Ajouter.</li>
        <li>Ouvrez To do list depuis son icône et touchez <strong>Scanner le QR code</strong>.</li></ol>
        <p class="fHint">Vous pouvez aussi connecter Safari tel quel, sans notifications.</p>`,
      change: `<p class="setText">Un nouveau code remplace l'actuel. <strong>Tous vos autres appareils seront déconnectés</strong> et devront scanner un nouveau QR code. Leurs tâches ne sont pas perdues : elles seront fusionnées à la reconnexion. L'ancien code de secours ne servira plus à rien.</p>
        <p class="setText">À utiliser si un appareil a été perdu ou volé, ou si le code de secours a été vu par quelqu'un.</p>`,
    };
    const cancel = '<button type="button" class="btn" data-sync="cancel">Annuler</button>';
    const foot = {
      start: cancel,
      show: '<button type="button" class="btn primary" data-sync="cancel">Terminé</button>',
      secret: '<button type="button" class="btn" data-sync="show">Retour</button><button type="button" class="btn primary" data-sync="cancel">Terminé</button>',
      scan: cancel,
      enter: `${cancel}<button type="button" class="btn primary" data-sync="join-typed">Continuer</button>`,
      confirm: `${cancel}<button type="button" class="btn primary" data-sync="join-pending" disabled>Connecter cet appareil</button>`,
      ios: `<button type="button" class="btn" data-sync="ios-anyway">Connecter Safari</button><button type="button" class="btn primary" data-sync="cancel">J'ai compris</button>`,
      change: `${cancel}<button type="button" class="btn dangerBtn" data-sync="change-go">Changer le code</button>`,
    };
    const titles = { start: 'Synchroniser mes appareils', show: 'Ajouter un appareil', secret: 'Code de secours', scan: 'Scanner le QR code', enter: 'Saisir le code', confirm: 'Connecter cet appareil', ios: 'Installer sur l\'iPhone', change: 'Changer de code' };
    $('#dlgSyncTitle').textContent = titles[this.step];
    body.innerHTML = steps[this.step] + '<p class="fErr" id="syncMsg" role="alert" hidden></p>';
    $('#syncFoot').innerHTML = `<span class="spin" id="syncSpin" hidden aria-label="En cours"></span>${foot[this.step]}`;
    const first = body.querySelector('input');
    if (first) setTimeout(() => first.focus(), 30);
    else if (this.step === 'confirm') setTimeout(() => { const c = $('#syncFoot [data-sync="cancel"]'); if (c) c.focus(); }, 30);
    if (this.step === 'show') this.startOffer(gen);
    if (this.step === 'scan') this.startScan();
    if (this.step === 'confirm') this.loadPending(gen);
  },
  live(gen, step) { return gen === this.gen && this.step === step && $('#dlgSync').open; },

  /* ---- appareil déjà synchronisé : QR code à usage unique, valable 10 minutes ---- */
  async startOffer(gen) {
    const st = $('#qrState'), wrap = $('#syncQrWrap');
    const say = (html, cls = '') => { if (st) { st.innerHTML = html; st.className = `qrState ${cls}`; } };
    let offer;
    try { offer = await cloud.offerPairing(); } catch (e) {
      if (!this.live(gen, 'show')) return;
      say(`<span>${e.offline ? 'Pas de connexion au serveur.' : 'QR code indisponible pour le moment.'}</span><button type="button" class="btn" data-sync="show">Réessayer</button>`, 'over');
      return;
    }
    if (!this.live(gen, 'show')) return;
    this.offer = offer;
    renderQr(pairUrl(offer.token));
    $('#pairCodeTxt').textContent = pairCode.format(offer.token);
    $('#pairLine').hidden = false;
    say('', 'gone');
    wrap.classList.remove('masked');
    const info = $('#pairInfo');
    const tick = async () => {
      if (!this.live(gen, 'show')) { this.stopTimer(); return; }
      const left = Math.max(0, offer.expires - Date.now());
      let s = null;
      try { s = await cloud.pairStatus(offer.id); } catch (e) { /* réessayé au passage suivant */ }
      if (!this.live(gen, 'show')) return;
      if (s && s.state === 'used') {
        offer.done = true; this.stopTimer();
        wrap.classList.add('masked'); $('#pairLine').hidden = true;
        const at = s.at ? new Date(s.at) : new Date();
        say(`${icon('ok')}<span>Utilisé à ${pad(at.getHours())}:${pad(at.getMinutes())}</span><button type="button" class="btn" data-sync="show">Ajouter un autre appareil</button>`, 'over ok');
        info.innerHTML = `Un appareil vient de se connecter avec ce QR code. <strong>Si ce n'est pas vous, changez de code tout de suite</strong> (Réglages, puis Changer de code).`;
        return;
      }
      if (!left || (s && s.state === 'expired')) {
        this.stopTimer();
        wrap.classList.add('masked'); $('#pairLine').hidden = true;
        say(`<span>QR code expiré</span><button type="button" class="btn" data-sync="show">Nouveau QR code</button>`, 'over');
        info.textContent = 'Pour votre sécurité, chaque QR code ne sert qu\'une fois et expire au bout de 10 minutes.';
        return;
      }
      const min = Math.ceil(left / 60000);
      info.textContent = `Ce QR code ne sert qu'une fois. Il expire dans ${min} minute${min > 1 ? 's' : ''}.`;
    };
    this.timer = setInterval(tick, 3000);
    tick();
  },

  startScan() {
    const video = $('#scanVideo'), state = $('#scanState');
    const say = (t) => { if (state) state.textContent = t; };
    scanner.start(video, (text) => {
      const p = parsePairing(text);
      if (!p) { say('Ce QR code n\'est pas un QR code To do list. Visez celui affiché dans les Réglages de l\'autre appareil.'); return; }
      scanner.stop();
      if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* ignore */ }
      this.joinWith(p);
    }, (s) => {
      if (s === 'live') say('Visez le QR code affiché sur l\'autre appareil.');
      else if (s === 'denied') { say('Accès à l\'appareil photo refusé. Autorisez-le dans les réglages, ou saisissez le code.'); }
      else if (s === 'nocam') { this.step = 'enter'; this.render(); toast('Pas d\'appareil photo disponible : saisissez le code.'); }
      else if (s === 'nolib') say('Le lecteur de QR code n\'a pas pu démarrer. Saisissez le code.');
    });
  },
  /* QR code scanné, lien ouvert ou code saisi : toujours une confirmation avant de connecter. */
  joinWith(p) {
    this.input = p; this.pending = null;
    const dlg = $('#dlgSync');
    this.step = 'confirm';
    if (!dlg.open) dlg.showModal();
    this.render();
  },
  async loadPending(gen) {
    const box = $('#syncInfo');
    await Promise.resolve();
    const input = this.input;
    try {
      if (!this.pending) {
        if (!input) throw new Error('Aucun code.');
        const got = input.kind === 'token' ? await cloud.takePairing(input.v) : input.v;
        // réponse d'une demande abandonnée entre-temps (annulée, autre QR code) : ignorée
        if (!this.live(gen, 'confirm') || this.input !== input) return;
        this.pending = got; this.input = null;
      }
      if (!this.live(gen, 'confirm')) return;
      if (cloud.isOn() && cloud.st.code !== this.pending) {
        const t = $('#confirmText');
        if (t) t.textContent = 'Cet appareil est déjà synchronisé avec une autre liste. Le connecter à celle-ci à la place ? Ses tâches actuelles y seront ajoutées.';
      }
      if (cloud.isOn() && cloud.st.code === this.pending) {
        this.pending = null; this.step = 'show'; this.render();
        toast('Cet appareil est déjà connecté à cette liste.');
        return;
      }
      const code = this.pending;
      const info = await cloud.info(code);
      if (!this.live(gen, 'confirm') || this.pending !== code) return;
      box.innerHTML = listInfoHTML(info);
      // court délai avant de pouvoir confirmer : on lit avant de cliquer
      setTimeout(() => { if (this.live(gen, 'confirm')) { const go = $('#syncFoot [data-sync="join-pending"]'); if (go) go.disabled = false; } }, 1500);
    } catch (e) {
      if (!this.live(gen, 'confirm') || (input && this.input && this.input !== input)) return;
      if (e.badCode) { this.pending = null; this.input = null; this.step = 'enter'; this.render(); this.fail(e); return; }
      // erreur passagère : le code déjà récupéré est gardé, on peut réessayer
      if (box) {
        box.textContent = e.offline ? 'Pas de connexion au serveur. Vérifiez le réseau, puis réessayez.' : (e.message || 'Vérification impossible pour le moment.');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.sync = 'retry-info'; b.textContent = 'Réessayer';
        box.appendChild(b);
      }
    }
  },
  async act(a) {
    const msg = $('#syncMsg'); if (msg) msg.hidden = true;
    try {
      if (a === 'cancel') { this.pending = null; this.input = null; this.close(); return; }
      if (a === 'scan') { this.step = 'scan'; this.render(); return; }
      if (a === 'enter') { this.step = 'enter'; this.render(); return; }
      if (a === 'show') { this.step = 'show'; this.render(); return; }
      if (a === 'secret') { this.step = 'secret'; this.render(); return; }
      if (a === 'secret-reveal') { const c = $('#secretTxt'); if (c) c.classList.remove('masked'); return; }
      if (a === 'copy') { copyText(syncCode.format(cloud.st.code)).then((ok) => toast(ok ? 'Code de secours copié. Effacez-le du presse-papiers après usage.' : 'Copie impossible.')); return; }
      if (a === 'create') {
        this.busy(true);
        await cloud.create();
        this.step = 'show'; this.render();
        return;
      }
      if (a === 'join-typed') {
        const raw = $('#syncCodeInput').value;
        const c = syncCode.normalize(raw);
        if (c.length !== 13 && c.length !== 20) { this.fail(new Error(`Le code contient 13 caractères (${c.length} saisis).`)); return; }
        const p = parsePairing(c);
        if (!p) { this.fail(new Error('Ce code contient une faute de frappe : vérifiez-le caractère par caractère.')); return; }
        this.joinWith(p);
        return;
      }
      if (a === 'join-pending') {
        if (!this.pending) return;
        this.busy(true);
        await cloud.join(this.pending);
        this.pending = null;
        this.step = 'show'; this.render();
        toast('Appareil connecté : vos tâches sont synchronisées.', { duration: 6000 });
        return;
      }
      if (a === 'ios-anyway' || a === 'retry-info') { this.step = 'confirm'; this.render(); return; }
      if (a === 'change-go') {
        this.busy(true);
        await cloud.changeCode();
        this.step = 'show'; this.render();
        toast(cloud.status === 'ready' ? 'Nouveau code créé. Les autres appareils doivent scanner un nouveau QR code.'
          : 'Nouveau code créé. L\'envoi des tâches reprendra automatiquement ; l\'ancien code sera retiré ensuite.', { duration: 9000 });
        return;
      }
      if (a === 'push') { await cloud.enablePush(); this.render(); return; }
    } catch (e) {
      if (e.badCode && this.step === 'confirm') { this.step = 'enter'; this.render(); }
      this.fail(e);
    }
  },
  /* Lien de connexion (#jumelage=… ou #lien=…) : QR code scanné avec l'appareil photo du téléphone. */
  handleLink(hash = INITIAL_HASH) {
    if (!cloud.enabled || !/(jumelage|lien)=/.test(hash || '')) return;
    if (this.lastLink === hash && Date.now() - this.lastLinkAt < 5000) return; // même lien reçu deux fois au lancement
    this.lastLink = hash; this.lastLinkAt = Date.now();
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    const p = parsePairing(appBaseUrl() + hash);
    if (!p) { toast('Ce lien de connexion est incomplet : scannez à nouveau le QR code.'); return; }
    if (p.kind === 'code' && cloud.isOn() && cloud.st.code === p.v) { toast('Cet appareil est déjà connecté à cette liste.'); return; }
    this.input = p; this.pending = null;
    if (cloud.needsIosInstall()) { this.open('ios'); return; }
    this.open('confirm');
  },
};
function listInfoHTML(info) {
  const n = Number(info && info.tasks) || 0, d = Number(info && info.devices) || 0;
  const created = info && info.created_at ? new Date(info.created_at) : null;
  const when = created && !isNaN(created) ? created.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const hm = created && !isNaN(created) ? `${pad(created.getHours())}:${pad(created.getMinutes())}` : '';
  const parts = [
    when ? `Liste créée le <strong>${esc(when)}</strong> à ${esc(hm)}` : 'Liste synchronisée',
    n ? `<strong>${n}</strong> tâche${n > 1 ? 's' : ''}` : 'aucune tâche pour l\'instant',
    d ? `notifications sur <strong>${d}</strong> appareil${d > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return `${icon('sync')}<span>${parts.join(' · ')}</span>`;
}
function pushBlockHTML() {
  if (!cloud.isOn() || !cloud.key) return '';
  if (cloud.needsIosInstall()) {
    return '<div class="hintBox"><strong>Notifications sur iPhone</strong><p>Installez d\'abord l\'application : bouton <strong>Partager</strong> de Safari, puis <strong>« Sur l\'écran d\'accueil »</strong>. Ouvrez-la ensuite depuis son icône pour activer les notifications.</p></div>';
  }
  if (cloud.pushActive() || !cloud.pushSupported()) return '';
  return `<div class="hintBox"><strong>Recevoir les rappels sur cet appareil</strong><p>Même application fermée : le serveur envoie la notification à l'heure prévue, sans connaître son contenu.</p><div class="btnRow"><button type="button" class="btn primary" data-sync="push">${icon('bell')}Activer les notifications</button></div></div>`;
}
function renderQr(text) {
  const box = $('#syncQr');
  if (!box || typeof qrcode !== 'function' || !text) return;
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { box.hidden = true; }
}
function renderSyncSettings() {
  const sec = $('#setSyncSec');
  if (!sec) return;
  sec.hidden = !cloud.enabled;
  if (!cloud.enabled) return;
  const txt = $('#setSyncText'), btns = $('#setSyncBtns');
  if (cloud.isDead()) {
    txt.innerHTML = 'Le code de synchronisation a été changé sur un autre appareil. Scannez le nouveau QR code pour reprendre ; vos tâches restent sur cet appareil et seront fusionnées.';
    btns.innerHTML = `<button type="button" class="btn primary" data-syncset="scan">${icon('camera')}Scanner le nouveau QR code</button><button type="button" class="btn" data-syncset="signout">Arrêter la synchronisation ici</button>`;
    return;
  }
  if (!cloud.isOn()) {
    txt.innerHTML = 'Retrouvez la même liste sur votre ordinateur et votre téléphone, avec les rappels en notification. Les appareils se connectent en scannant un QR code : pas d\'e-mail, pas de mot de passe. Chiffré de bout en bout.';
    btns.innerHTML = `<button type="button" class="btn primary" data-syncset="open">${icon('sync')}Synchroniser mes appareils</button>`;
    return;
  }
  const s = cloud.statusLine();
  txt.innerHTML = `${esc(s.text)}. ${cloud.pushActive() ? 'Notifications activées sur cet appareil.' : ''}`;
  btns.innerHTML = `<button type="button" class="btn primary" data-syncset="show">${icon('qr')}Afficher le QR code</button>
    <button type="button" class="btn" data-syncset="now">${icon('sync')}Synchroniser maintenant</button>
    ${cloud.pushActive() ? `<button type="button" class="btn" data-syncset="pushoff">${icon('bell')}Couper les notifications ici</button>` : `<button type="button" class="btn" data-syncset="push">${icon('bell')}Activer les notifications ici</button>`}
    <button type="button" class="btn" data-syncset="change">Changer de code</button>
    <button type="button" class="btn dangerBtn" data-syncset="signout">Déconnecter cet appareil</button>`;
}
function bindSync() {
  if (!cloud.enabled) return;
  const dlg = $('#dlgSync');
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sync]');
    if (b) syncUi.act(b.dataset.sync);
    else if (e.target === dlg) syncUi.close();
  });
  dlg.addEventListener('close', () => { scanner.stop(); syncUi.stopTimer(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const primary = $('#syncFoot .btn.primary');
    if (primary && !primary.disabled) primary.click();
  });
  dlg.addEventListener('input', (e) => {
    if (e.target.id !== 'syncCodeInput') return;
    const el = e.target, c = syncCode.normalize(el.value).slice(0, 20);
    // 13 caractères (QR code à usage unique) par groupes de 4, code de secours (20) par groupes de 5
    const f = !c ? '' : c.length <= 13 ? pairCode.format(c) : syncCode.format(c);
    if (f !== el.value) { el.value = f; el.setSelectionRange(f.length, f.length); }
  });
  $('#setSyncBtns').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-syncset]');
    if (!b) return;
    const a = b.dataset.syncset;
    if (a === 'open') { $('#dlgSettings').close(); syncUi.open('start'); }
    else if (a === 'show') { $('#dlgSettings').close(); syncUi.open('show'); }
    else if (a === 'scan') { $('#dlgSettings').close(); syncUi.open('scan'); }
    else if (a === 'change') { $('#dlgSettings').close(); syncUi.open('change'); }
    else if (a === 'now') { await cloud.sync(); toast(cloud.status === 'ready' ? 'Synchronisé.' : cloud.statusLine().text); }
    else if (a === 'push') { await cloud.enablePush(); renderSyncSettings(); }
    else if (a === 'pushoff') { await cloud.unsubscribePush(); renderSyncSettings(); toast('Notifications coupées sur cet appareil.'); }
    else if (a === 'signout') {
      const c = await confirmDialog({ title: 'Déconnecter cet appareil ?', text: 'Les tâches restent sur cet appareil, mais ne seront plus synchronisées ni notifiées. Vos autres appareils ne sont pas touchés. Pour le reconnecter, il suffira de rescanner le QR code.', buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'ok', label: 'Déconnecter', primary: true, danger: true }] });
      if (c === 'ok') { await cloud.disconnect(); toast('Appareil déconnecté de la synchronisation.'); }
      refreshSettings();
    }
  });
  // État partagé entre fenêtres : connexion, déconnexion ou nouveau code dans une autre fenêtre
  window.addEventListener('storage', async (e) => {
    if (e.key !== KEY_CLOUD) return;
    let fresh = null;
    try { fresh = JSON.parse(e.newValue || 'null'); } catch (err) { fresh = null; }
    const was = cloud.st && cloud.st.code;
    if (!fresh || !fresh.code) { if (was) { cloud.st = cloud.blank(); cloud.key = null; cloud.access = null; cloud.status = 'off'; renderStatus(); refreshSettings(); } return; }
    cloud.st = { ...cloud.blank(), ...fresh };
    if (fresh.code !== was) { await cloud.applyCode(); cloud.status = fresh.dead ? 'unpaired' : 'ready'; cloud.bind(); }
    else if (fresh.dead) cloud.status = 'unpaired';
    renderStatus(); refreshSettings();
  });
  // Ouvrir la tâche d'une notification (clic sur la notification, application déjà ouverte)
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'open' && d.t) openTaskFromNotification(d.t);
  });
}
function openTaskFromNotification(id) {
  if (!byId(id)) { cloud.sync().then(() => { if (byId(id)) openTaskFromNotification(id); }); return; }
  if (ui.view === 'done' || (ui.view === 'today' && !inToday(byId(id)))) setView('todo');
  select(id, { open: true });
}

/* ---------- Démarrage ---------- */
function boot() {
  let framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed) {
    document.body.textContent = '';
    const p = document.createElement('p');
    p.style.cssText = 'font: 16px/1.5 system-ui, sans-serif; padding: 24px;';
    p.textContent = 'To do list doit être ouverte dans son propre onglet.';
    document.body.appendChild(p);
    return;
  }
  els.app = $('#app');
  els.todayLabel = $('#todayLabel');
  els.countTodo = $('#count-todo');
  els.countToday = $('#count-today');
  els.countMatrix = $('#count-matrix');
  els.matrix = $('#matrix');
  els.scrim = $('#scrim');
  els.list = $('#list');
  els.scroll = $('#listScroll');
  els.detail = $('#detail');
  els.status = $('#status');
  els.toasts = $('#toasts');
  els.qa = $('#qaInput');
  els.search = $('#search');
  els.rcards = $('#rcards');
  if (typeof els.toasts.showPopover === 'function') { els.toasts.setAttribute('popover', 'manual'); els.rcards.setAttribute('popover', 'manual'); }

  const local = loadLocal();
  if (local) state = local;
  applyTheme();
  snapshotDaily();

  bindQuickAdd();
  bindSearch();
  bindList();
  bindMatrix();
  els.scrim.addEventListener('click', () => closeOverlay());
  bindDetail();
  bindSettings();

  $('.views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('.views').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = $$('.views [role="tab"]');
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); setView(n.dataset.view);
  });
  $('#installCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-install]');
    if (!b) return;
    if (b.dataset.install === 'go') pwa.install();
    else { lsSet(KEY_INSTALL_LATER, String(Date.now())); pwa.render(); }
  });
  $('#setAppBtns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-app]');
    if (!b) return;
    if (b.dataset.app === 'install') { $('#dlgSettings').close(); pwa.install(); }
    else if (b.dataset.app === 'share') pwa.shareLink();
  });
  $('#syncCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-synccard]');
    if (!b) return;
    if (b.dataset.synccard === 'scan') syncUi.open('scan');
    else if (b.dataset.synccard === 'code') syncUi.open('enter');
    else { lsSet('odj.synccard.later', String(Date.now())); renderSetupCard(); }
  });
  $('#setupCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-setup]');
    if (!b) return;
    if (b.dataset.setup === 'create') fileSync.createNew();
    else if (b.dataset.setup === 'open') fileSync.openExisting();
    else { lsSet(KEY_SETUP_LATER, String(Date.now())); renderSetupCard(); toast('D\'accord. Vos tâches restent enregistrées dans Chrome ; la sauvegarde se règle aussi depuis les Réglages.'); }
  });
  els.status.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status-act]');
    if (!b) return;
    const a = b.dataset.statusAct;
    if (a === 'link') { $('#dlgSettings').showModal(); refreshSettings(); }
    else if (a === 'create') fileSync.createNew();
    else if (a === 'reconnect') fileSync.reconnect();
    else if (a === 'retry') fileSync.writeNow();
    else if (a === 'export') exportJson();
    else if (a === 'sync-scan') syncUi.open('scan');
    else if (a === 'sync-now') cloud.sync();
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', () => { if (els.app.classList.contains('detailOpen')) closeOverlay({ fromPop: true }); });
  window.addEventListener('resize', debounce(() => { if (!overlayMode()) { els.app.classList.remove('detailOpen'); els.scrim.hidden = true; } else if (els.app.classList.contains('detailOpen')) els.scrim.hidden = isNarrow(); autosize($('#dTitle', els.detail)); autosize($('#dNotes', els.detail)); }, 120));

  // Synchronisation entre onglets ouverts sur le même fichier
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY_DATA || !e.newValue) return;
    try {
      const d = normData(JSON.parse(e.newValue));
      if (d && d.savedAt > state.savedAt) {
        cancelPendingCompletes();
        const strip = (ts) => JSON.stringify(ts.map((t) => ({ ...t, remind: t.remind ? { date: t.remind.date, time: t.remind.time } : null })));
        const onlyRuntime = strip(d.tasks) === strip(state.tasks);
        state = d; applyTheme();
        if (!onlyRuntime) { ui.undo = []; ui.redo = []; ui.coalesceKey = null; }
        if (!byId(ui.selectedId)) ui.selectedId = null;
        render();
        reminders.refresh();
      }
    } catch (err) { /* ignore */ }
  });

  // Écrire le fichier avant de quitter, et vérifier les changements faits ailleurs au retour
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') fileSync.flush();
    else { fileSync.checkExternal(); render({ detail: false }); }
  });
  window.addEventListener('focus', () => fileSync.checkExternal());
  window.addEventListener('pagehide', () => fileSync.flush());

  // Glisser un fichier JSON sur la fenêtre pour l'importer
  let dragDepth = 0, hintEl = null;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth++;
    if (!hintEl) { hintEl = document.createElement('div'); hintEl.className = 'dropHint'; hintEl.textContent = 'Déposez une sauvegarde JSON pour l\'importer'; document.body.appendChild(hintEl); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth && hintEl) { hintEl.remove(); hintEl = null; } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0;
    if (hintEl) { hintEl.remove(); hintEl = null; }
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  // Changement de jour pendant que la fenêtre reste ouverte
  let day = todayISO();
  setInterval(() => {
    if (todayISO() !== day) { day = todayISO(); snapshotDaily(); render(); }
  }, 30000);

  render();
  if (!isNarrow()) {
    const ids = navOrder();
    if (ids.length) selectIndex(0, { scroll: false });
  }
  renderQuickHint();
  fileSync.init();
  reminders.init();
  pwa.init();
  bindSync();
  cloud.init().then(() => syncUi.handleLink()).catch((e) => console.warn('Synchronisation', e));
  // Lien ouvert alors que l'application est déjà ouverte : changement d'ancre, ou relance de l'application installée
  window.addEventListener('hashchange', () => syncUi.handleLink(location.hash));
  if ('launchQueue' in window && window.launchQueue && typeof window.launchQueue.setConsumer === 'function') {
    window.launchQueue.setConsumer((params) => {
      if (!params || !params.targetURL) return;
      let u; try { u = new URL(params.targetURL); } catch (e) { return; }
      if (u.hash) syncUi.handleLink(u.hash);
      const q = u.searchParams;
      if (q.has('nouvelle')) setTimeout(() => els.qa.focus(), 50);
      if (q.get('vue') === 'aujourdhui') setView('today');
      if (q.get('tache')) openTaskFromNotification(q.get('tache'));
    });
  }
  // Une fenêtre modale rend la page inerte : on masque les cartes de rappel le temps qu'elle est ouverte.
  for (const d of $$('dialog')) {
    const open = d.showModal.bind(d);
    d.showModal = () => {
      try { if (els.rcards.matches(':popover-open')) els.rcards.hidePopover(); } catch (e) { /* ignore */ }
      els.rcards.hidden = true;
      open();
    };
    d.addEventListener('close', () => { reminders.sig = ''; if (!document.querySelector('dialog[open]')) reminders.refresh(); });
  }
  if (!ui.storageOk) renderStatus();

  // Point d'accès pour les tests automatisés : présent seulement dans les versions de test (build.mjs)
  /*@test*/window.__odj = { cloud, syncUi, syncCode, scanner, select, setSetting, pwa, reminders, buildIcs, remindMs, state: () => state, ui, nextOccurrence, holidays, parseQuick, workdaysOfMonth, fileSync, idb, serialize, normData, VERSION, pairCode, parsePairing, vault };/*@endtest*/
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
