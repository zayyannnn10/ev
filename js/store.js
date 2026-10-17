/* Phone E.V. storage. Everything lives on the phone: settings, missions, memory, chat, notes,
   expenses, contacts, routines (localStorage) and generated files (IndexedDB). The Gemini key is
   kept apart from the backup so an exported backup never contains it. */
(function () {
  const K = 'ev-phone-v1', KEY = 'ev-phone-key';
  const DEF = {
    settings: { name: '', rate: 1.0, voice: 'Ava', language: 'English', palette: false, remindEvery: 30,
                autoSleep: 5, reminders: true, setupDone: false },
    tasks: [], memory: [], chat: [], notes: [], expenses: [], contacts: [], routines: [],
    files: [], jobs: [], spotify: null, models: null, lastSeen: 0
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  let data;
  try { data = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { data = null; }
  data = Object.assign(clone(DEF), data || {});
  data.settings = Object.assign(clone(DEF.settings), data.settings || {});
  if (!data.settings.liveVoice) { data.settings.voiceEngine = 'live'; data.settings.liveVoice = true; }   // the laptop's Gemini Live voice
  if (!data.settings.normalSpeed) { data.settings.rate = 1.0; data.settings.normalSpeed = true; }   // the user asked for normal speed

  // first run: keep the missions from the design concept if they were edited there
  try {
    const old = JSON.parse(localStorage.getItem('ev-spider-signal') || 'null');
    if (old && Array.isArray(old.tasks) && !data.tasks.length && !data.settings.setupDone) {
      data.tasks = old.tasks.filter(t => t.text && !/one good idea|walk without your phone|look forward to/i.test(t.text))
        .map(t => ({ id: uid(), text: t.text, done: !!t.done, due: null, created: Date.now() }));
      if (typeof old.dark === 'boolean') data.settings.palette = old.dark;
    }
  } catch (e) {}

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  let timer = null;
  function save(now) {
    clearTimeout(timer);
    const write = () => { try { localStorage.setItem(K, JSON.stringify(data)); } catch (e) { console.warn('save', e); } };
    now ? write() : (timer = setTimeout(write, 120));
  }
  addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });

  const key = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} }
  };

  /* files (PDFs, slides, mind maps, notes) in IndexedDB */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ev-phone-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode), s = t.objectStore('files');
      const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  const files = {
    async put(name, blob, kind, meta) {
      const id = uid();
      await tx('readwrite', s => s.put({ id, name, blob, type: blob.type, created: Date.now(), meta: meta || null }));
      data.files.unshift({ id, name, kind: kind || '', type: blob.type, size: blob.size, created: Date.now() });
      save(); return id;
    },
    async get(id) { return tx('readonly', s => s.get(id)); },
    async del(id) { await tx('readwrite', s => s.delete(id)); data.files = data.files.filter(f => f.id !== id); save(); },
    list() { return data.files; }
  };

  function exportJSON() {
    const copy = clone(data); delete copy.models; delete copy.spotify;
    return JSON.stringify({ app: 'E.V. phone', version: 1, exported: new Date().toISOString(), data: copy }, null, 1);
  }
  function importJSON(text) {
    const j = JSON.parse(text);
    if (!j || j.app !== 'E.V. phone' || !j.data) throw new Error('This is not an E.V. backup file.');
    const keepFiles = data.files, keepSpotify = data.spotify, keepModels = data.models;
    Object.keys(data).forEach(k => delete data[k]);
    Object.assign(data, clone(DEF), j.data, { files: keepFiles, spotify: keepSpotify, models: keepModels });
    data.settings = Object.assign(clone(DEF.settings), j.data.settings || {});
    save(true);
  }

  window.EV = window.EV || {};
  EV.store = { data, save, key, files, uid, exportJSON, importJSON };

  /* diagnostics: what happened recently (Settings → Diagnostics shows it; never contains the key) */
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem('ev-phone-log') || '[]'); } catch (e) {}
  let logTimer = null;
  EV.log = msg => {
    const line = new Date().toTimeString().slice(0, 8) + '  ' + String(msg).replace(/key=[^&\s]+/g, 'key=…');
    logs.push(line); if (logs.length > 120) logs.splice(0, logs.length - 120);
    clearTimeout(logTimer); logTimer = setTimeout(() => { try { localStorage.setItem('ev-phone-log', JSON.stringify(logs)); } catch (e) {} }, 300);
  };
  EV.logs = () => logs.slice();
  addEventListener('error', e => EV.log('error: ' + e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')'));
  addEventListener('unhandledrejection', e => EV.log('unhandled: ' + (e.reason && e.reason.message || e.reason)));
  EV.log('start ' + (EV.VERSION || '') + ' · ' + navigator.userAgent.replace(/.*(iPhone OS [\d_]+).*/, '$1') +
    (matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' · home screen app' : ' · browser'));
})();
