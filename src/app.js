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

const DEFAULT_SETTINGS = Object.freeze({ theme: 'auto', addTo: 'bottom', holidays: true, doneTodayOpen: false, remindTime: '09:00', remindSound: true, remindSticky: true });

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
    id: typeof t.id === 'string' && t.id ? t.id : uid(),
    title: str(t.title).slice(0, 500),
    notes: str(t.notes),
    steps: Array.isArray(t.steps)
      ? t.steps.filter((s) => s && typeof s === 'object').map((s) => ({ id: typeof s.id === 'string' && s.id ? s.id : uid(), text: str(s.text), done: !!s.done }))
      : [],
    done,
    doneAt: done ? (num(t.doneAt) ?? now) : null,
    position: num(t.position) ?? 0,
    due: isISO(t.due) ? t.due : null,
    repeat: normRepeat(t.repeat),
    createdAt: num(t.createdAt) ?? now,
    updatedAt: num(t.updatedAt) ?? now,
    spawnedId: typeof t.spawnedId === 'string' ? t.spawnedId : null,
    seriesId: typeof t.seriesId === 'string' && t.seriesId ? t.seriesId : null,
    remind: normRemind(t.remind),
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
  if (typeof s.remindSound === 'boolean') settings.remindSound = s.remindSound;
  if (typeof s.remindSticky === 'boolean') settings.remindSticky = s.remindSticky;
  // suppressions récentes (60 jours), pour qu'une fusion ne fasse pas réapparaître une tâche supprimée
  const deleted = {};
  const limit = Date.now() - 60 * 86400000;
  if (d.deleted && typeof d.deleted === 'object') {
    for (const [id, at] of Object.entries(d.deleted)) if (typeof at === 'number' && at > limit && !seen.has(id)) deleted[id] = at;
  }
  return { tasks, settings, savedAt: num(d.savedAt) ?? 0, deleted };
}
function serialize(data = state) {
  return JSON.stringify({ app: APP, schema: SCHEMA, version: VERSION, savedAt: data.savedAt, settings: data.settings, tasks: data.tasks, deleted: data.deleted || {} }, null, 2);
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
  return JSON.stringify({ app: APP, schema: SCHEMA, version: VERSION, savedAt: state.savedAt, settings: state.settings, tasks: state.tasks, deleted: state.deleted });
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
  render({ detail: opts.detail !== false });
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
function undo() {
  if (cancelPendingCompletes()) return;
  const e = ui.undo.pop();
  if (!e) { toast('Rien à annuler.'); return; }
  ui.redo.push({ tasks: JSON.stringify(state.tasks), label: e.label, sel: ui.selectedId });
  state.tasks = keepRemindRuntime(JSON.parse(e.tasks), state.tasks);
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
  state.tasks = keepRemindRuntime(JSON.parse(e.tasks), state.tasks);
  ui.coalesceKey = null;
  if (e.sel && byId(e.sel)) ui.selectedId = e.sel;
  persist();
  render();
  reminders.refresh();
  toast(`Rétabli : ${e.label.toLowerCase()}.`);
}
function setSetting(key, value) {
  state.settings[key] = value;
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
  t.updatedAt = Date.now();
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
  t.done = true; t.doneAt = now; t.updatedAt = now;
  if (t.remind) { t.remind.ack = true; t.remind.snooze = null; }
  if (!t.repeat) return null;
  const next = nextAfterCompletion(t);
  const clone = normTask({
    ...JSON.parse(JSON.stringify(t)),
    id: uid(), done: false, doneAt: null, due: next,
    steps: t.steps.map((s) => ({ id: uid(), text: s.text, done: false })),
    createdAt: now, updatedAt: now, spawnedId: null,
    seriesId: t.seriesId || t.id,
    remind: null,
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
  t.done = false; t.doneAt = null; t.updatedAt = Date.now();
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
  renderList();
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
  for (const r of $$('.row', els.list)) {
    const on = r.dataset.id === ui.selectedId;
    r.classList.toggle('sel', on);
    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  }
}
function rowEl(id) { return id ? els.list.querySelector(`.row[data-id="${CSS.escape(id)}"]`) : null; }

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
  if (open && isNarrow()) openOverlay();
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
  try { history.pushState({ odjDetail: true }, ''); } catch (e) { /* file:// peut refuser */ }
}
function closeOverlay({ fromPop = false } = {}) {
  if (!els.app.classList.contains('detailOpen')) return;
  els.app.classList.remove('detailOpen');
  if (!fromPop && history.state && history.state.odjDetail) { try { history.back(); } catch (e) { /* ignore */ } }
  const r = rowEl(ui.selectedId);
  if (r) r.scrollIntoView({ block: 'nearest' });
  els.list.focus({ preventScroll: true });
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
  if (!order) { toast('Le classement se modifie depuis les onglets À faire ou Aujourd\'hui, hors recherche.'); return; }
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
    if (isNarrow()) closeOverlay();
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
      <textarea class="notes" id="dNotes" data-k="notes" aria-labelledby="hNotes" placeholder="Contexte, interlocuteurs, chemins de fichiers, liens, ce qu'il ne faut pas oublier…">${esc(t.notes)}</textarea>
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
const RE_URL = /\bhttps?:\/\/[^\s<>"']+/gi;
const RE_PATH = /(?:\b[A-Za-z]:\\|\\\\[^\s\\/:*?"<>|]+\\)[^\r\n"<>|*?]*/g;
function detectLinks(text) {
  const out = [];
  const seen = new Set();
  const push = (kind, v) => {
    v = v.replace(/[\s.,;:)\]]+$/, '');
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
      commit(() => { t.title = v; t.updatedAt = Date.now(); }, { undo: 'Modification du titre', coalesce: `title:${t.id}`, detail: false });
    } else if (k === 'notes') {
      autosize(el);
      commit(() => { t.notes = nfc(el.value); t.updatedAt = Date.now(); }, { undo: 'Modification des notes', coalesce: `notes:${t.id}`, detail: false });
      linksLater(t);
    } else if (k.startsWith('step:')) {
      const s = t.steps.find((x) => x.id === k.slice(5)); if (!s) return;
      commit(() => { s.text = nfc(el.value); t.updatedAt = Date.now(); }, { undo: "Modification d'une étape", coalesce: k, detail: false });
    } else if (k === 'nth') {
      const n = parseInt(el.value, 10);
      if (!(n >= 1 && n <= 23)) return;
      commit(() => {
        t.repeat = { type: 'nth', n };
        shiftDue(t, nextOccurrence(t.repeat, todayISO(), true));
        t.updatedAt = Date.now();
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
        t.updatedAt = Date.now();
      }, { undo: 'Répétition modifiée', detail: false });
      updateDetailBits(t);
      if (type === 'nth') $('#dNth', pane).focus();
    } else if (k.startsWith('stepchk:')) {
      const s = t.steps.find((x) => x.id === k.slice(8)); if (!s) return;
      commit(() => { s.done = el.checked; t.updatedAt = Date.now(); }, { undo: el.checked ? 'Étape cochée' : 'Étape décochée', detail: false });
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
      if (isNarrow()) closeOverlay(); else els.list.focus({ preventScroll: true });
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
        commit(() => { s.text = el.value.slice(0, caret); t.steps.splice(i + 1, 0, ns); t.updatedAt = Date.now(); }, { undo: 'Ajout d\'étape', detail: false });
        renderSteps(t, { sid: ns.id, at: 'start' });
        updateDetailBits(t);
      } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
        if (!el.value) { e.preventDefault(); removeStep(t, sid, 'prev'); }
        else if (i > 0) { // fusion avec l'étape précédente
          e.preventDefault();
          const prev = t.steps[i - 1];
          const at = prev.text.length;
          commit(() => { prev.text += el.value; t.steps.splice(i, 1); t.updatedAt = Date.now(); }, { undo: 'Fusion d\'étapes', detail: false });
          renderSteps(t);
          const pe = els.detail.querySelector(`[data-k="step:${CSS.escape(prev.id)}"]`);
          if (pe) { pe.focus(); pe.setSelectionRange(at, at); }
          updateDetailBits(t);
        }
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= t.steps.length) return;
        commit(() => { const [s] = t.steps.splice(i, 1); t.steps.splice(j, 0, s); t.updatedAt = Date.now(); }, { undo: 'Déplacement d\'étape', detail: false });
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
  commit(() => { for (const x of texts) t.steps.push({ id: uid(), text: nfc(x).slice(0, 300), done: false }); t.updatedAt = Date.now(); }, { undo: texts.length > 1 ? 'Ajout d\'étapes' : 'Ajout d\'étape', detail: false });
  renderSteps(t);
  updateDetailBits(t);
}
function removeStep(t, sid, focusWhere) {
  const i = t.steps.findIndex((s) => s.id === sid);
  if (i < 0) return;
  commit(() => { t.steps.splice(i, 1); t.updatedAt = Date.now(); }, { undo: "Suppression d'étape", detail: false });
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
    t.updatedAt = Date.now();
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
    t.updatedAt = Date.now();
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
    if (id === 'test') { this.testCard = false; this.closeNote('test'); this.refresh(); if (document.activeElement === document.body) els.list.focus({ preventScroll: true }); return; }
    const t = byId(id);
    if (!t || !t.remind) { this.refresh(); return; }
    this.closeNote(id);
    if (how === 'done') { commit(() => { t.remind.ack = true; }, { undo: false, detail: false }); setDone(id, true); }
    else if (how === 'open' || how === 'ok') {
      commit(() => { t.remind.ack = true; }, { undo: false, detail: false });
      if (how === 'open') { window.focus(); if (ui.view === 'done') setView('todo'); select(id, { open: true }); }
    } else if (how.startsWith('snz:')) {
      const ms = snoozeTarget(how.slice(4));
      commit(() => { t.remind.snooze = ms; t.remind.ack = false; }, { undo: false, detail: false });
      toast(`Rappel reporté ${fmtWhenLong(ms)}.`);
    }
    const sel = byId(ui.selectedId); if (sel) updateDetailBits(sel);
    this.refresh();
    // la carte a disparu : rendre le focus à la liste plutôt qu'à la page
    if (how !== 'open' && (document.activeElement === document.body || !document.activeElement)) els.list.focus({ preventScroll: true });
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
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
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
    `UID:${t.seriesId || t.id}@ordre-du-jour`,
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
    card.hidden = !(this.web && !this.standalone() && this.promptEvent && Date.now() - later > 3 * 86400000);
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
  el.hidden = !setupCardWanted();
}
function setupCardWanted() {
  const later = +(lsGet(KEY_SETUP_LATER) || 0);
  const installPending = typeof pwa !== 'undefined' && !$('#installCard').hidden;
  return fileSync.supported && !fileSync.handle && !!fileSync.ready && !installPending && Date.now() - later > 3 * 86400000;
}
function renderStatus() {
  renderSetupCard();
  const s = fileSync.status();
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
      loadData({ tasks: merged.tasks, settings: data.savedAt > state.savedAt ? data.settings : state.settings, savedAt: 0, deleted: merged.deleted }, 'Fusion avec le fichier', { undoable: true });
      persist();
      const bits = [];
      if (merged.added) bits.push(plural(merged.added, 'tâche ajoutée', 'tâches ajoutées'));
      if (merged.updated) bits.push(plural(merged.updated, 'tâche mise à jour', 'tâches mises à jour'));
      if (merged.removed) bits.push(plural(merged.removed, 'tâche supprimée', 'tâches supprimées'));
      toast(`Modifications reprises depuis ${this.handle.name} : ${bits.join(', ') || 'liste mise à jour'}.`, { action: 'Annuler', onAction: undo, duration: 9000 });
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
    commit(() => { state.tasks = keepRemindRuntime(data.tasks, state.tasks); }, { undo: 'Import' });
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
  $('#prefRemTime').value = state.settings.remindTime;
  $('#prefRemSound').checked = state.settings.remindSound;
  $('#prefRemSticky').checked = state.settings.remindSticky;
  reminders.renderSettings();
  pwa.render();
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
      commit(() => { state.tasks = keepRemindRuntime(data.tasks, state.tasks); }, { undo: 'Restauration' });
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
      if (els.qa.value) { els.qa.value = ''; renderQuickHint(); } else { els.qa.blur(); els.list.focus({ preventScroll: true }); }
    } else if (e.key === 'ArrowDown' && !els.qa.value) {
      e.preventDefault();
      els.list.focus({ preventScroll: true });
      if (!byId(ui.selectedId) || !navOrder().includes(ui.selectedId)) selectIndex(0);
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
      else { els.search.blur(); els.list.focus({ preventScroll: true }); }
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      run.flush();
      const ids = navOrder();
      if (ids.length) { els.list.focus({ preventScroll: true }); select(ids[0], { open: e.key === 'Enter' }); }
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
  if (isNarrow()) openOverlay();
  const ta = $('#dTitle', els.detail);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function setView(v) {
  if (ui.query) { ui.query = ''; els.search.value = ''; }
  ui.view = v;
  render({ detail: false });
  const ids = navOrder();
  if (!ids.includes(ui.selectedId)) { if (!isNarrow()) selectIndex(0, { quiet: true }); else { ui.selectedId = null; renderDetail(); } }
  els.scroll.scrollTop = 0;
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

  if (ctrl && !e.altKey && (k === 'f' || k === 'F')) { e.preventDefault(); els.search.focus(); els.search.select(); return; }
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
  const digit = { Digit1: 'todo', Numpad1: 'todo', Digit2: 'today', Numpad2: 'today', Digit3: 'done', Numpad3: 'done' }[e.code];
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
      e.preventDefault(); els.search.focus(); els.search.select(); return;
    case '?':
      e.preventDefault(); $('#dlgShortcuts').showModal(); return;
    case 'ArrowDown': case 'j': case 'J':
      e.preventDefault(); if (isNarrow() && els.app.classList.contains('detailOpen')) return; moveSelection(1); els.list.focus({ preventScroll: true }); return;
    case 'ArrowUp': case 'k': case 'K':
      e.preventDefault(); if (isNarrow() && els.app.classList.contains('detailOpen')) return; moveSelection(-1); els.list.focus({ preventScroll: true }); return;
    case 'Home':
      e.preventDefault(); selectIndex(0); return;
    case 'End':
      e.preventDefault(); selectIndex(navOrder().length - 1); return;
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
    case 'Delete':
      if (!ui.selectedId) return;
      e.preventDefault(); deleteTask(ui.selectedId); return;
    case 'Escape':
      if (isNarrow() && els.app.classList.contains('detailOpen')) { e.preventDefault(); closeOverlay(); return; }
      if (ui.query) { e.preventDefault(); ui.query = ''; els.search.value = ''; render({ detail: false }); }
      return;
    default:
  }
}

/* ---------- Démarrage ---------- */
function boot() {
  els.app = $('#app');
  els.todayLabel = $('#todayLabel');
  els.countTodo = $('#count-todo');
  els.countToday = $('#count-today');
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
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', () => { if (els.app.classList.contains('detailOpen')) closeOverlay({ fromPop: true }); });
  window.addEventListener('resize', debounce(() => { if (!isNarrow()) els.app.classList.remove('detailOpen'); autosize($('#dTitle', els.detail)); autosize($('#dNotes', els.detail)); }, 120));

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

  // Point d'accès pour les tests automatisés et le débogage
  window.__odj = { pwa, reminders, buildIcs, remindMs, state: () => state, ui, nextOccurrence, holidays, parseQuick, workdaysOfMonth, fileSync, idb, serialize, normData, VERSION };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
