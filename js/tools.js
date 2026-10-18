/* Phone E.V.'s tools: what Gemini can ask the phone to do. Each has a declaration (what the model sees)
   and a run(args) that returns a small result object. A result with {needs_tap, open, label} becomes a
   button the user taps (iPhone only lets apps like WhatsApp open from a tap). */
(function () {
  const st = EV.store, G = EV.gemini, ui = () => EV.ui;
  const S = 'STRING', N = 'NUMBER', I = 'INTEGER', B = 'BOOLEAN', O = 'OBJECT', A = 'ARRAY';
  const obj = (props, req) => ({ type: O, properties: props, required: req || [] });
  const str = (d, e) => e ? { type: S, description: d, enum: e } : { type: S, description: d };
  const REG = {};
  const def = (name, description, parameters, run) => REG[name] = { decl: { name, description, parameters }, run };

  const lc = s => String(s || '').toLowerCase().trim();
  function matchItem(list, q, field = 'text') {
    q = lc(q); if (!q) return null;
    return list.find(x => x.id === q) || list.find(x => lc(x[field]) === q) || list.find(x => lc(x[field]).includes(q)) ||
      list.find(x => q.split(/\s+/).filter(w => w.length > 2).every(w => lc(x[field]).includes(w))) || null;
  }
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  /* due times as the model gives them: full ISO, a date, or just "20:00" (= today, or tomorrow if it has passed) */
  function parseDue(v) {
    if (!v) return null;
    v = String(v).trim();
    const now = new Date();
    const tm = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (tm) {
      let h = +tm[1]; const m = +tm[2], ap = (tm[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      const d = new Date(now); d.setHours(h, m, 0, 0); if (d < now) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
    let d = new Date(v.replace(' ', 'T'));
    if (isNaN(d)) return null;
    if (d < now - 36e5) {                         // a date in the past is a guess: keep the time, today or tomorrow
      const t = new Date(now); t.setHours(d.getHours(), d.getMinutes(), 0, 0); if (t < now) t.setDate(t.getDate() + 1); d = t;
    }
    return d.toISOString();
  }

  async function saveFile(out, kind, meta) {
    const list = Array.isArray(out) ? out : [out], names = [], ids = [];
    for (const f of list) { ids.push(await st.files.put(f.name, f.blob, kind, meta)); names.push(f.name); }
    ui().filesChanged();
    return Object.assign(names, { ids });
  }
  const openShare = names => names.ids && names.ids.length ? [{ label: 'Open', action: 'open_file', id: names.ids[0] }, { label: 'Share', action: 'share_file', id: names.ids[0] }] : [];

  /* ---------- missions, memory, notes ---------- */
  def('my_tasks', "The user's missions (tasks and reminders): add (text, due = full ISO 8601 local date-time like 2026-10-14T20:00 if a time was given; use the current date from the system instruction), list, done, delete, snooze (minutes).",
    obj({ action: str('', ['add', 'list', 'done', 'delete', 'snooze']), text: str('the task, or words to find it'), due: str('ISO 8601 local date-time'), minutes: { type: I } }, ['action']),
    a => {
      const T = st.data.tasks;
      if (a.action === 'add') {
        if (!a.text) return { error: 'What should the mission say?' };
        const t = { id: st.uid(), text: a.text.trim(), done: false, due: parseDue(a.due), created: Date.now(), nagged: 0 };
        T.unshift(t); st.save(); ui().tasksChanged();
        return { result: 'Mission added' + (t.due ? ' for ' + when(t.due) : '') + '.', open_missions: T.filter(x => !x.done).length };
      }
      if (a.action === 'list') {
        const open = T.filter(x => !x.done);
        return { open: open.map(x => x.text + (x.due ? ' (' + when(x.due) + ')' : '')), done_today: T.filter(x => x.done && x.doneAt > Date.now() - 864e5).length };
      }
      const t = matchItem(T.filter(x => a.action === 'delete' || !x.done), a.text);
      if (!t) return { error: 'No mission matches "' + (a.text || '') + '".', open: T.filter(x => !x.done).map(x => x.text) };
      if (a.action === 'done') { t.done = true; t.doneAt = Date.now(); }
      if (a.action === 'delete') st.data.tasks = T.filter(x => x !== t);
      if (a.action === 'snooze') { t.due = new Date(Date.now() + (a.minutes || 30) * 6e4).toISOString(); t.fired = false; }
      st.save(); ui().tasksChanged();
      return { result: { done: 'Marked done: ', delete: 'Deleted: ', snooze: 'Snoozed: ' }[a.action] + t.text };
    });

  def('memory', 'Lasting facts about the user (name, family, likes, where they study). remember, forget, recall.',
    obj({ action: str('', ['remember', 'forget', 'recall']), text: str('the fact') }, ['action']),
    a => {
      const M = st.data.memory;
      if (a.action === 'remember') { if (!a.text) return { error: 'Nothing to remember.' }; M.push({ id: st.uid(), text: a.text.trim(), t: Date.now() }); st.save(); return { result: 'Remembered.' }; }
      if (a.action === 'forget') { const m = matchItem(M, a.text); if (!m) return { error: 'I have nothing like that saved.' }; st.data.memory = M.filter(x => x !== m); st.save(); return { result: 'Forgotten: ' + m.text }; }
      return { facts: M.map(m => m.text) };
    });

  def('notes', 'Voice notes / notes on the phone: save (title, text), list, read (title), delete (title), search (text).',
    obj({ action: str('', ['save', 'list', 'read', 'delete', 'search']), title: str(''), text: str('') }, ['action']),
    a => {
      const L = st.data.notes;
      if (a.action === 'save') { const n = { id: st.uid(), title: a.title || (a.text || 'Note').split(/\s+/).slice(0, 6).join(' '), text: a.text || '', t: Date.now() }; L.unshift(n); st.save(); return { result: 'Saved the note "' + n.title + '".' }; }
      if (a.action === 'list') return { notes: L.slice(0, 20).map(n => n.title) };
      if (a.action === 'search') return { notes: L.filter(n => lc(n.title + ' ' + n.text).includes(lc(a.text))).slice(0, 10).map(n => ({ title: n.title, text: n.text.slice(0, 400) })) };
      const n = matchItem(L, a.title || a.text, 'title');
      if (!n) return { error: 'No note called that.' };
      if (a.action === 'delete') { st.data.notes = L.filter(x => x !== n); st.save(); return { result: 'Deleted the note.' }; }
      return { title: n.title, text: n.text.slice(0, 3000) };
    });

  /* ---------- focus, timers, sleep ---------- */
  def('hero_mode', 'Hero mode = focus timer: start (minutes, default 25), stop, status.',
    obj({ action: str('', ['start', 'stop', 'status']), minutes: { type: I } }, ['action']),
    a => ui().hero(a.action, a.minutes));
  def('timer', 'Countdown timers and alarms while E.V. is open: set (minutes, label), cancel (label), list.',
    obj({ action: str('', ['set', 'cancel', 'list']), minutes: { type: N }, label: str('') }, ['action']),
    a => ui().timer(a.action, a.minutes, a.label));
  const SLEEPY = /\b(sleep|goodnight|good night|bye|goodbye|see you|that'?s all|stop listening|shut up|go away|so ?jao|off)\b/i;
  def('ev_sleep', "Put E.V. to sleep. ONLY when the user's latest message itself says go to sleep, goodnight, bye for now. Never because of something said earlier.", obj({}), () => {
    const said = (EV.live && EV.live.open) ? EV.live.lastUserWords : (st.data.chat.filter(m => m.role === 'user').slice(-1)[0] || {}).text || '';
    if (!SLEEPY.test(said || '')) { EV.log('ev_sleep refused (user did not ask): ' + String(said).slice(0, 60)); return { error: 'The user did not ask you to sleep just now. Do not sleep; carry on the conversation.' }; }
    setTimeout(() => ui().sleep(), 1200); return { result: 'Going to sleep.' };
  });
  def('kill_switch', 'Stop everything: speech, listening, timers, recordings and running jobs.', obj({}), () => { ui().killAll(); return { result: 'Stopped everything.' }; });

  /* ---------- settings ---------- */
  def('ev_settings', "Change E.V.'s settings: name (what to call the user), speed (voice speed 0.8-1.6), language, palette (symbiote on/off), remind_every (minutes), auto_sleep (minutes), voice (iPhone voice name, e.g. Ava). setting='list' shows them.",
    obj({ setting: str('', ['list', 'name', 'speed', 'language', 'palette', 'remind_every', 'auto_sleep', 'voice']), value: str('') }, ['setting']),
    a => {
      const s = st.data.settings, v = a.value;
      switch (a.setting) {
        case 'name': s.name = String(v || '').trim(); break;
        case 'speed': s.rate = Math.min(1.6, Math.max(0.8, parseFloat(v) || 1.0)); break;
        case 'language': s.language = String(v || 'English').trim(); break;
        case 'palette': s.palette = /on|true|yes|symbiote|dark/i.test(String(v)); ui().applyPalette(); break;
        case 'remind_every': s.remindEvery = Math.max(5, parseInt(v) || 30); break;
        case 'auto_sleep': s.autoSleep = Math.max(0, parseInt(v) || 0); break;
        case 'voice': s.voice = String(v || 'Ava').split(/\s|\(/)[0]; break;
        default: return { settings: { name: s.name, speed: s.rate, language: s.language, palette: s.palette ? 'symbiote' : 'normal', remind_every: s.remindEvery, auto_sleep: s.autoSleep, voice: EV.voice.voiceName() } };
      }
      st.save(); return { result: 'Changed ' + a.setting + '.' };
    });

  /* ---------- camera and pictures ---------- */
  def('camera', "The phone camera inside E.V.: open, close, what_is_this (identify what the user shows), read_page (read a page or handwritten notes; save_as pdf/txt/note). To EXPLAIN a question or homework on paper, use the study tool with source camera instead.",
    obj({ action: str('', ['open', 'close', 'what_is_this', 'read_page']), question: str(''), save_as: str('', ['none', 'pdf', 'txt', 'note']) }, ['action']),
    async a => {
      if (a.action === 'close') { ui().camera.close(); return { result: 'Camera closed.' }; }
      if (a.action === 'open') { const ok = await ui().camera.open(); return ok ? { result: 'Camera is open.' } : { needs_tap: true, label: 'Open camera', action: 'camera', result: 'Tap "Open camera" to allow the camera.' }; }
      const shot = await ui().camera.capture();
      if (!shot) return { needs_tap: true, label: 'Open camera', action: 'camera', result: 'The camera needs a tap to start. Tap "Open camera", then ask again.' };
      if (a.action === 'what_is_this') {
        return { answer: await G.vision((a.question || 'What is the object the person is showing? Identify it and add one useful or funny fact.') + ' Answer in 1-3 short spoken sentences.', shot) };
      }
      const text = await G.vision('Transcribe ALL the text on this page exactly (handwriting included). Keep line breaks and headings. Output only the text.', shot);
      const res = { text: text.slice(0, 3000) };
      if (a.save_as === 'pdf') res.saved = await saveFile(await EV.docs.textToPdf('Page notes', text), 'pdf');
      if (a.save_as === 'txt') res.saved = await saveFile({ blob: new Blob([text], { type: 'text/plain' }), name: EV.docs.fname('Page notes', 'txt') }, 'txt');
      if (a.save_as === 'note') { st.data.notes.unshift({ id: st.uid(), title: 'Page notes ' + new Date().toLocaleDateString('en-GB'), text, t: Date.now() }); st.save(); res.saved = 'notes'; }
      return res;
    });
  def('look_at_image', "Look at a screenshot or photo from the user's gallery ('see my screen', 'what's in this screenshot'). The user picks it with a tap.",
    obj({ question: str('what to look for') }),
    a => ({ needs_tap: true, label: 'Choose a picture', action: 'pick_image', question: a.question || '', result: 'Tap "Choose a picture" and pick the screenshot or photo.' }));

  /* ---------- internet ---------- */
  def('web_search', 'Current facts from Google: news facts, scores, prices, opening hours, anything recent (for weather use the weather tool).',
    obj({ query: str('') }, ['query']),
    async a => { const r = await G.search(a.query); return { answer: r.text.slice(0, 2500), sources: r.sources.slice(0, 4).map(s => s.title), live_sources: r.live }; });

  const WX = { 0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail' };
  def('weather', 'Live weather now and for the next 3 days for a city (free weather service, no limits). Use this for every weather question.',
    obj({ place: str('city or place') }, ['place']),
    async a => {
      const g = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: a.place, count: '1', language: 'en' }))).json();
      const p = g.results && g.results[0]; if (!p) return { error: 'I could not find a place called ' + a.place + '.' };
      const w = await (await fetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({ latitude: p.latitude, longitude: p.longitude, timezone: 'auto', forecast_days: '3',
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' }))).json();
      const c = w.current, d = w.daily;
      return { place: p.name + (p.country ? ', ' + p.country : ''),
        now: `${Math.round(c.temperature_2m)} degrees, feels like ${Math.round(c.apparent_temperature)}, ${WX[c.weather_code] || 'mixed'}, humidity ${c.relative_humidity_2m} percent, wind ${Math.round(c.wind_speed_10m)} km/h`,
        days: d.time.map((t, i) => `${new Date(t).toLocaleDateString('en-GB', { weekday: 'long' })}: ${Math.round(d.temperature_2m_min[i])} to ${Math.round(d.temperature_2m_max[i])} degrees, ${WX[d.weather_code[i]] || 'mixed'}, rain chance ${d.precipitation_probability_max[i] ?? 0} percent`) };
    });

  def('news', 'News, only when the user asks for news: topic ("" for today\'s top news, "Pakistan", "tech", anything).',
    obj({ topic: str('') }),
    async a => {
      const r = await G.search('Latest news' + (a.topic ? ' about ' + a.topic : ' today, top stories, with Pakistan and world') + '.',
        'Give the 6 most important current news stories. One per line, exactly in this format:\nHEADLINE || SOURCE || ONE SENTENCE SUMMARY\nNo other text.');
      const stories = r.text.split('\n').map(l => l.split('||').map(x => x.trim())).filter(x => x.length >= 3 && x[0])
        .map((x, i) => ({ title: x[0].replace(/^[-*\d.\s]+/, ''), source: x[1], summary: x[2], url: (r.sources[i] || {}).url || '' }));
      ui().openSheet('news', { topic: a.topic || 'Today', stories });
      return { stories: stories.map(s => s.title + ' (' + s.source + '): ' + s.summary), shown: 'News panel is open.' };
    });

  def('research', 'Deep research on a topic: searches many sources and makes a PDF report (runs while E.V. is open). depth quick or deep.',
    obj({ topic: str(''), depth: str('', ['quick', 'deep']), details: str('') }, ['topic']),
    a => {
      const job = ui().job('Research: ' + a.topic);
      (async () => {
        try {
          job.update(.05, 'Planning');
          const n = a.depth === 'deep' ? 7 : 4;
          const plan = await G.ask(`Plan research on "${a.topic}". ${a.details || ''} Give ${n} specific Google search questions that together cover it well. Return JSON {"questions": [str]}`, { json: true, speed: 'fast' });
          const qs = (plan.questions || []).slice(0, n), notes = [], sources = [];
          for (let i = 0; i < qs.length; i++) {
            if (job.cancelled) return;
            job.update(.1 + .7 * i / qs.length, qs[i]);
            try { const r = await G.search(qs[i], 'Research this thoroughly with up-to-date sources. Give facts, numbers and dates.'); notes.push('Q: ' + qs[i] + '\n' + r.text); sources.push(...r.sources); } catch (e) { notes.push('Q: ' + qs[i] + '\n(failed: ' + e.message + ')'); }
          }
          job.update(.85, 'Writing the report');
          const doc = await G.ask(`Write a clear research report about "${a.topic}" from these notes. Use only facts in the notes.
Return JSON {"title": str, "summary": str (3-4 sentences, spoken style), "sections": [{"heading": str, "paragraphs": [str], "bullets": [str]}]} with 5-8 sections including key takeaways.\n\n${notes.join('\n\n').slice(0, 60000)}`, { json: true });
          const uniq = [...new Map(sources.filter(s => s.url).map(s => [s.url, s])).values()].slice(0, 25);
          const names = await saveFile(await EV.docs.pdf({ title: doc.title || a.topic, subtitle: 'Research report by E.V. · ' + new Date().toLocaleDateString('en-GB'), sections: doc.sections, sources: uniq }), 'pdf');
          job.done('Report ready: ' + names[0]);
          ui().fileReady(`Your research on ${a.topic} is done. ${doc.summary || ''} The full report is in your stash.`, openShare(names));
        } catch (e) { job.fail(e.message); }
      })();
      return { result: 'Research started. It shows in Files while it runs; I\'ll tell you when the report is ready. Keep E.V. open.' };
    });

  def('create_pdf', 'Make a well-formatted document about a topic (researched with Google): format pdf (default) or docx (Word). For study notes use the study tool instead.',
    obj({ topic: str(''), details: str(''), format: str('', ['pdf', 'docx']) }, ['topic']),
    async a => {
      const facts = await G.search(a.topic + ' ' + (a.details || ''), 'Collect accurate, current facts, figures and context for a document about this.').catch(() => ({ text: '', sources: [] }));
      const doc = await G.ask(`Write a well-structured document about "${a.topic}". ${a.details || ''}
Return JSON {"title": str, "sections": [{"heading": str, "paragraphs": [str], "bullets": [str]}]} (4-7 sections). Use these facts:\n${facts.text.slice(0, 20000)}`, { json: true });
      const d = { title: doc.title || a.topic, sections: doc.sections, sources: facts.sources }, word = a.format === 'docx';
      const names = await saveFile(await (word ? EV.docs.docx(d) : EV.docs.pdf(d)), word ? 'docx' : 'pdf', { doc: d });
      ui().fileOffers(openShare(names));
      return { result: (word ? 'Word file' : 'PDF') + ' ready in the stash: ' + names[0] + '. Open and Share buttons are on the screen.' };
    });

  /* ---------- study help ---------- */
  const LEVEL = { brief: 'Keep it short and to the point: about one page.', easy: 'Very simple words and short sentences, like explaining to a smart 14-year-old; about one to two pages.',
                  detailed: 'Thorough but still clear: three to five pages with more depth, examples and exam-style detail.' };
  const SECTIONS = {
    question: 'What the question is asking (in plain words); What you need to know (the ideas behind it); Step by step (put the working in "steps"); The answer; Why it works and an exam tip; Try a similar one (a similar question, then its answer in brackets)',
    quiz: 'Questions (10, mixed multiple choice and short answer, numbered in "steps"); Answers (each answer with a one-line reason, in "steps")',
    topic: 'The big idea (in simple words); Breaking it down (each part as a bullet "Part: what it means"); How it works, step by step (in "steps"); Everyday example; Key terms (bullets "Term: meaning"); Common mistakes; Quick recap (3-5 bullets); Test yourself (3-5 questions with the answers in brackets)',
  };
  const blobB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  async function uploadParts(want) {               // a photo or file she added to her stash -> what Gemini can read
    const all = st.files.list(), up = all.filter(f => f.kind === 'upload');
    const w = lc(want || '');
    const f = (w && (all.find(x => x.id === want) || up.find(x => lc(x.name).includes(w)) || up.find(x => w.split(/\s+/).some(t => t.length > 3 && lc(x.name).includes(t))))) || up[0];
    if (!f) throw new Error('There is no uploaded file yet. Tap "Upload photos or files" in your stash first.');
    const rec = await st.files.get(f.id), type = rec.type || rec.blob.type || '', ext = (f.name.split('.').pop() || '').toLowerCase();
    if (/^image\//.test(type)) return { name: f.name, parts: [{ inlineData: { mimeType: 'image/jpeg', data: await blobB64(rec.blob) } }] };
    if (ext === 'pdf' || type === 'application/pdf') {
      if (rec.blob.size > 18e6) throw new Error('That PDF is too big to read at once (over 18 MB). Try a smaller part of it.');
      return { name: f.name, parts: [{ inlineData: { mimeType: 'application/pdf', data: await blobB64(rec.blob) } }] };
    }
    if (rec.meta && rec.meta.text) return { name: f.name, parts: [{ text: 'CONTENT OF THE FILE "' + f.name + '":\n' + rec.meta.text.slice(0, 80000) }] };
    throw new Error(`I can't read ${ext ? '.' + ext : 'this kind of'} files. Save it as a PDF, a Word file (.docx) or a photo and upload it again.`);
  }
  async function studyDoc(a, img, fileParts) {
    const kind = a.mode === 'question' ? 'question' : a.mode === 'quiz' ? 'quiz' : 'topic';
    const what = a.mode === 'question' ? (a.question || (img ? 'the question in the picture' : fileParts ? 'the attached file' : a.topic)) : (a.topic || a.question || (fileParts ? 'the attached file' : ''));
    const prompt = `You are a kind, clear tutor making study notes for a student.
${kind === 'question' ? 'Explain this question and how to solve it' : kind === 'quiz' ? 'Make a practice quiz on' : 'Topic'}: ${what}
${fileParts ? 'Work from the file she uploaded (attached): explain what it is about and what is happening in it; for an assignment, what each question asks and how to approach it.\n' : ''}${LEVEL[a.level] || LEVEL.easy} Write in ${/english/i.test(st.data.settings.language || 'English') ? 'English' : st.data.settings.language + ' (with the English words for school terms)'} unless the topic is in another language. Short sentences, simple words. Put key terms in **bold**. Be accurate; never invent facts.
Use these sections (adapt or drop any that don't fit): ${SECTIONS[kind]}.${img ? '\nThe question is in the picture: read it carefully first (handwriting too) and quote it in the first section.' : ''}
Return JSON {"title": str (short), "one_line": str (the whole idea or answer in one simple sentence), "sections": [{"heading": str, "paragraphs": [str], "bullets": [str], "steps": [str]}]}`;
    const doc = await G.ask(prompt, { json: true, parts: fileParts || (img ? [{ inlineData: { mimeType: 'image/jpeg', data: img } }] : []) });
    doc.title = doc.title || what || 'Study notes';
    doc.subtitle = (kind === 'quiz' ? 'Practice quiz' : 'Study notes') + ' by E.V. · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return doc;
  }
  def('study', "Study help (the main reason she uses E.V.): explain or break down a topic simply, explain a question and what is happening in it (typed, on paper with the camera, or a photo from her gallery), make study notes as a Word file (docx) or PDF, or a practice quiz. output voice (default) = you explain it out loud yourself; docx / pdf / both = also make the notes file (only when she asks for notes, a file, Word, docx or PDF). source camera when the question is on paper in front of the camera, photo when it is a picture in her gallery, file for a photo or assignment file she UPLOADED to her stash (newest unless she names it in file).",
    obj({ mode: str('', ['explain', 'breakdown', 'question', 'notes', 'quiz']), topic: str('the topic or subject'), question: str('the question, if she typed or said it'),
          level: str('', ['brief', 'easy', 'detailed']), output: str('', ['voice', 'docx', 'pdf', 'both']), source: str('', ['text', 'camera', 'photo', 'file']),
          file: str('which uploaded file (words from its name); empty = the newest') }, ['mode']),
    async a => {
      let img = a._image || null; const out = a.output || (a.mode === 'notes' ? 'docx' : 'voice');
      if (a.source === 'camera' && !img) {
        img = await ui().camera.capture();
        if (!img) return { needs_tap: true, label: 'Open camera', action: 'camera', result: 'Tap "Open camera", point it at the question, then ask again.' };
      }
      if (a.source === 'photo' && !img) return { needs_tap: true, label: 'Choose the photo', action: 'study_photo', args: { ...a, source: 'photo' }, result: 'Tap "Choose the photo" and pick the picture of the question.' };
      let file = null;
      if (a.source === 'file') file = await uploadParts(a.file);
      if (out === 'voice') {
        const how = 'Teach like a kind, clear tutor: first the big idea in one simple sentence, then break it into small parts in simple words with an everyday example, then a short recap. '
          + (a.mode === 'question' ? 'For a question: say what it is asking, the idea behind it, go through the steps one by one, give the answer, then a quick tip. Explain HOW to get the answer, not only the answer. ' : '')
          + ({ brief: 'Keep it brief: about thirty seconds.', detailed: 'Go into detail, like a short lesson.' }[a.level] || 'Keep it easy and clear, about a minute.')
          + ' At the end, check she understood ("Does that make sense?") and offer Word or PDF notes.';
        if (file) {
          const ex = await G.ask(`You are a kind, clear tutor. She uploaded the attached file ("${file.name}") and asks: ${a.question || a.topic || 'what is happening in this file? Explain it to me.'}
Read it carefully (handwriting too). Explain what it is about and what is happening in it in simple words; for an assignment or questions, say what each one asks, the ideas behind it and how to approach it step by step, with answers if she asks for them. ${LEVEL[a.level] || LEVEL.easy} Plain text, no markdown.`, { parts: file.parts });
          return { file: file.name, explained: ex.slice(0, 6000), instruction: how + ' Use this explanation of her file and say it in your own natural spoken words.' };
        }
        if (!img) return { how_to_explain: how, instruction: 'Explain it yourself now, out loud, in that way. Speak naturally; no lists read out.' };
        const ex = await G.vision(`You are a kind tutor. Read the question in this picture carefully (handwriting too). Then explain: what it is asking, the idea behind it, the steps to solve it one by one, the answer, and a short tip. ${LEVEL[a.level] || LEVEL.easy} Plain text, no markdown.`, img);
        return { question_explained: ex.slice(0, 4000), instruction: how + ' Use this worked explanation and say it in your own natural spoken words, step by step.' };
      }
      const job = ui().job((a.mode === 'quiz' ? 'Quiz: ' : 'Notes: ') + (a.topic || a.question || (file && file.name) || 'your question'));
      (async () => {
        try {
          job.update(.2, 'Writing the notes');
          const doc = await studyDoc(a, img, file && file.parts);
          job.update(.75, out === 'pdf' ? 'Making the PDF' : 'Making the Word file');
          let first = null;
          if (out === 'docx' || out === 'both') first = await saveFile(await EV.docs.docx(doc), 'docx', { doc });
          if (out === 'pdf' || out === 'both') { const n = await saveFile(await EV.docs.pdf(doc), 'pdf', { doc }); first = first || n; }
          job.done('Ready: ' + first[0]);
          const kind = out === 'both' ? 'as a Word file and a PDF' : out === 'pdf' ? 'as a PDF' : 'as a Word file';
          ui().fileReady(`Your ${a.mode === 'quiz' ? 'quiz' : 'notes'} on ${doc.title} ${a.mode === 'quiz' ? 'is' : 'are'} ready ${kind}. ${doc.one_line || ''}`, openShare(first));
        } catch (e) { job.fail(e.message); }
      })();
      return { result: `Making the ${out === 'both' ? 'Word and PDF' : out === 'pdf' ? 'PDF' : 'Word'} ${a.mode === 'quiz' ? 'quiz' : 'notes'} now (about half a minute). Meanwhile explain the main idea to her out loud in two or three simple sentences.` };
    });

  /* ---------- presentations and mind maps ---------- */
  def('presentation', 'PowerPoint presentations made on the phone. action create (topic, details, slides ~10, theme) or restyle (theme) the last one, or themes (list the 16 designs). Leave theme EMPTY unless the user named a style: the phone then shows the 16 styles to pick from. Themes: ' + EV.docs.THEMES.map(t => t.name).join(', ') + '.',
    obj({ action: str('', ['create', 'restyle', 'themes']), topic: str(''), details: str(''), slides: { type: I }, theme: str('') }, ['action']),
    async a => {
      if (a.action === 'themes') return { themes: EV.docs.THEMES.map(t => t.name) };
      const PICK = 'Nothing has been made yet. The 16 styles are now on the screen in the stash. Ask the user, briefly and naturally, which style they would like: they can tap one or just say it (for example Midnight Neon, Minimal White or Galaxy). Then stop and wait; do not call presentation again until they name one.';
      if (a.action === 'restyle') {
        if (!st.data.lastDeck) return { error: 'There is no presentation to restyle yet.' };
        if (!a.theme) { ui().pickStyle('your last presentation', th => restyle(th, true)); return { result: PICK + ' When they say one, call presentation restyle with that theme.' }; }
        ui().pickStyle(null);
        return restyle(a.theme);
      }
      if (!a.topic) return { error: 'What is the presentation about?' };
      if (!a.theme) { ui().pickStyle(a.topic, th => makeDeck({ ...a, theme: th }, true)); return { result: PICK + ' When they say one, call presentation create with the same topic and that theme.' }; }
      ui().pickStyle(null);
      return makeDeck(a);
    });
  async function restyle(theme, tapped) {
    const out = await EV.docs.presentation(st.data.lastDeck, theme);
    const names = await saveFile(out, 'pptx', { deck: st.data.lastDeck, theme: out.themeId });
    if (tapped) ui().fileReady(`Done, your presentation is now in ${out.theme}.`, openShare(names)); else ui().fileOffers(openShare(names));
    return { result: `Restyled in ${out.theme}: ${names[0]}. Open and Share buttons are on the screen.` };
  }
  function makeDeck(a, tapped) {
      if (tapped) ui().styleChosen(EV.docs.findTheme(a.theme).name);
      const job = ui().job('Slides: ' + a.topic);
      (async () => {
        try {
          job.update(.1, 'Planning the slides');
          const deck = await G.ask(`Plan a professional, engaging PowerPoint presentation about: ${a.topic}
Extra instructions: ${a.details || 'none'}. About ${a.slides || 10} slides. English unless told otherwise.
Use a VARIETY of layouts. Available layouts and their fields:
 title {title, subtitle} (first slide) · section {number, title, subtitle} · bullets {title, bullets[3-6 short]}
 two_column {title, left:{heading, bullets}, right:{heading, bullets}} · quote {quote, author}
 stats {title, stats:[{value, label}] (2-4 real numbers only), note} · timeline {title, steps:[{label, text}] 3-6}
 comparison {title, left:{heading, bullets}, right:{heading, bullets}} · image {title, bullets, image_query}
 closing {title, subtitle} (last slide)
Every slide also has "notes" (2-4 sentences the presenter can say). Keep bullets short (max ~12 words).
image_query = an exact English Wikipedia article title that has a good photo. Only use real facts/numbers.
Return JSON: {"title": str, "subtitle": str, "slides": [{"layout": str, ...fields, "notes": str}]}`, { json: true });
          st.data.lastDeck = deck; st.save();
          const out = await EV.docs.presentation(deck, a.theme || 'E.V. Night', (i, n) => job.update(.3 + .6 * i / n, 'Slide ' + (i + 1) + ' of ' + n));
          const names = await saveFile(out, 'pptx', { deck, theme: out.themeId });
          job.done('Slides ready: ' + names[0]);
          ui().fileReady(`Your presentation on ${a.topic} is ready, ${deck.slides.length} slides in ${out.theme}. Tap Open to see it, or Share to send or save it.`, openShare(names));
        } catch (e) { job.fail(e.message); }
      })();
      return { result: `Making the slides now in ${EV.docs.findTheme(a.theme).name}. They appear in the stash in about a minute.` };
  }

  def('mindmap', 'Mind map of a topic: ONE PDF with the flat map, three 3D rendered views and an outline. jpg=true only if the user asks for a JPG. size small, auto or detailed.',
    obj({ topic: str(''), details: str(''), size: str('', ['small', 'auto', 'detailed']), jpg: { type: B } }, ['topic']),
    a => {
      const job = ui().job('Mind map: ' + a.topic);
      (async () => {
        try {
          const n = { small: '5 main branches, 2-3 sub-branches each, 2 levels', detailed: '7-9 main branches, 3-5 sub-branches each, a third level where useful (max 70 nodes)' }[a.size] ||
            'choose the size that fits the topic (5-8 main branches, 2-4 sub-branches, a third level only where it adds real value; max 60 nodes)';
          job.update(.15, 'Planning branches');
          const spec = await G.ask(`Create a clear, well-organised mind map about: ${a.topic}
Extra instructions: ${a.details || 'none'}
Size: ${n}. Labels must be short (1-5 words, no sentences). Write in English unless the instructions say otherwise.
Return JSON: {"title": str, "branches": [{"name": str, "children": [{"name": str, "children": [{"name": str}]}]}]}`, { json: true });
          job.update(.5, 'Drawing the map and 3D views');
          await new Promise(r => setTimeout(r, 50));
          const names = await saveFile(await EV.docs.mindmap(spec.branches ? spec : { title: a.topic, branches: spec }, !!a.jpg), 'pdf');
          job.done('Mind map ready: ' + names.join(', '));
          ui().fileReady(`Your mind map on ${a.topic} is ready, with the 3D views. It's in your stash.`, openShare(names));
        } catch (e) { job.fail(e.message); }
      })();
      return { result: 'Drawing the mind map. It appears in Files in a moment.' };
    });

  /* ---------- money, lectures, prayer, wrap-up ---------- */
  def('expenses', 'Expense tracker: add (amount, category, note, date), report (month YYYY-MM), undo_last.',
    obj({ action: str('', ['add', 'report', 'undo_last']), amount: { type: N }, category: str(''), note: str(''), date: str('YYYY-MM-DD'), month: str('YYYY-MM') }, ['action']),
    a => {
      const E = st.data.expenses;
      if (a.action === 'add') { if (!a.amount) return { error: 'How much?' }; E.push({ id: st.uid(), amount: +a.amount, category: lc(a.category) || 'other', note: a.note || '', date: a.date || new Date().toISOString().slice(0, 10) }); st.save(); return { result: `Added ${a.amount} for ${a.category || 'other'}.` }; }
      if (a.action === 'undo_last') { const x = E.pop(); st.save(); return x ? { result: 'Removed ' + x.amount + ' ' + x.category + '.' } : { error: 'No expenses yet.' }; }
      const m = a.month || new Date().toISOString().slice(0, 7), list = E.filter(x => x.date.startsWith(m)), by = {};
      list.forEach(x => by[x.category] = (by[x.category] || 0) + x.amount);
      ui().openSheet('expenses', { month: m });
      return { month: m, total: list.reduce((s, x) => s + x.amount, 0), by_category: by, entries: list.length };
    });

  def('lecture', 'Record a lecture or meeting: start (title), stop (then E.V. writes a transcript, summary and action items as a note and PDF), status.',
    obj({ action: str('', ['start', 'stop', 'status']), title: str('') }, ['action']),
    a => ui().lecture(a.action, a.title));

  def('prayer_times', "Today's prayer times for a city.",
    obj({ city: str(''), country: str('') }),
    async a => {
      const city = a.city || 'Lahore', country = a.country || 'Pakistan';
      try {
        const r = await fetch('https://api.aladhan.com/v1/timingsByCity?' + new URLSearchParams({ city, country, method: '1', school: '1' }));
        const t = (await r.json()).data.timings;
        return { city, Fajr: t.Fajr, Sunrise: t.Sunrise, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha };
      } catch (e) { const r = await G.search(`prayer times today in ${city}, ${country}`); return { answer: r.text }; }
    });

  def('wrapup', "Today's summary: missions done and open, notes, spending.", obj({}),
    () => {
      const day = Date.now() - 864e5, today = new Date().toISOString().slice(0, 10);
      return { done_today: st.data.tasks.filter(t => t.done && t.doneAt > day).map(t => t.text), open: st.data.tasks.filter(t => !t.done).map(t => t.text + (t.due ? ' (' + when(t.due) + ')' : '')),
               notes_today: st.data.notes.filter(n => n.t > day).map(n => n.title), spent_today: st.data.expenses.filter(x => x.date === today).reduce((s, x) => s + x.amount, 0) };
    });

  /* ---------- people and apps (the user taps to send / call) ---------- */
  function person(to) {
    const t = String(to || '').trim();
    if (/^[+\d][\d\s()-]{6,}$/.test(t)) return { name: t, number: t.replace(/[^\d+]/g, '') };
    const c = st.data.contacts.find(c => lc(c.name) === lc(t) || (c.aliases || []).some(x => lc(x) === lc(t))) ||
      st.data.contacts.find(c => lc(c.name).includes(lc(t)) || (c.aliases || []).some(x => lc(x).includes(lc(t))));
    return c || null;
  }
  const digits = n => String(n || '').replace(/[^\d]/g, '');
  def('send_whatsapp', 'Write a WhatsApp message to a contact (name/alias) or number. E.V. opens WhatsApp with it typed; the user taps Send.',
    obj({ to: str(''), message: str('') }, ['to', 'message']),
    a => {
      const p = person(a.to);
      if (!p || !p.number) return { error: `I don't have a number for ${a.to}. Tell me the number and I'll save it.` };
      return { needs_tap: true, open: `https://wa.me/${digits(p.number)}?text=${encodeURIComponent(a.message)}`, label: 'Open WhatsApp: ' + p.name,
               result: `Message to ${p.name} is ready. WhatsApp opens with it typed; the user taps Send.` };
    });
  def('text_message', 'Write an SMS to a contact or number (user taps Send).', obj({ to: str(''), message: str('') }, ['to', 'message']),
    a => { const p = person(a.to); if (!p || !p.number) return { error: `No number for ${a.to}.` };
      return { needs_tap: true, open: `sms:${p.number.replace(/[^\d+]/g, '')}&body=${encodeURIComponent(a.message)}`, label: 'Open Messages: ' + p.name, result: 'SMS ready; the user taps Send.' }; });
  def('call', 'Phone call to a contact or number (the user taps Call).', obj({ to: str('') }, ['to']),
    a => { const p = person(a.to); if (!p || !p.number) return { error: `No number for ${a.to}.` };
      return { needs_tap: true, open: 'tel:' + p.number.replace(/[^\d+]/g, ''), label: 'Call ' + p.name, result: 'Ready to call; the user taps Call.' }; });
  def('send_email', 'Write an e-mail (opens Mail with it filled in; the user taps Send).', obj({ to: str('name or address'), subject: str(''), body: str('') }, ['to', 'body']),
    a => { const p = person(a.to), addr = /@/.test(a.to) ? a.to : (p && p.email) || '';
      if (!addr) return { error: `No e-mail address for ${a.to}.` };
      return { needs_tap: true, open: `mailto:${addr}?subject=${encodeURIComponent(a.subject || '')}&body=${encodeURIComponent(a.body)}`, label: 'Open Mail', result: 'E-mail ready; the user taps Send.' }; });
  def('contacts_book', 'Contacts for WhatsApp/calls: list, add (name, number with country code, email, aliases), remove, find.',
    obj({ action: str('', ['list', 'add', 'remove', 'find']), name: str(''), number: str(''), email: str(''), aliases: { type: A, items: { type: S } } }, ['action']),
    a => {
      const C = st.data.contacts;
      if (a.action === 'list') return { contacts: C.map(c => c.name) };
      if (a.action === 'add') { if (!a.name) return { error: 'Name?' }; const ex = C.find(c => lc(c.name) === lc(a.name)) || {}; Object.assign(ex, { name: a.name, number: a.number || ex.number || '', email: a.email || ex.email || '', aliases: a.aliases || ex.aliases || [] }); if (!C.includes(ex)) C.push(ex); st.save(); return { result: 'Saved ' + a.name + '.' }; }
      const c = person(a.name); if (!c) return { error: 'No contact called ' + a.name + '.' };
      if (a.action === 'remove') { st.data.contacts = C.filter(x => x !== c); st.save(); return { result: 'Removed ' + c.name + '.' }; }
      return { name: c.name, number: c.number, email: c.email };
    });
  def('show_map', 'Maps: show a place, or directions to it (opens Apple Maps).', obj({ place: str(''), directions: { type: B } }, ['place']),
    a => ({ needs_tap: true, open: 'https://maps.apple.com/?' + (a.directions ? 'daddr=' : 'q=') + encodeURIComponent(a.place), label: 'Open Maps: ' + a.place, result: 'Maps is ready.' }));
  def('open_link', 'Open YouTube (search or a video), Google search, or a website.', obj({ site: str('', ['youtube', 'google', 'website']), query: str(''), url: str('') }, ['site']),
    a => {
      const url = a.site === 'youtube' ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(a.query || '') :
        a.site === 'google' ? 'https://www.google.com/search?q=' + encodeURIComponent(a.query || '') :
        (/^https?:/.test(a.url || '') ? a.url : 'https://' + String(a.url || a.query || '').replace(/^\/+/, ''));
      return { needs_tap: true, open: url, label: a.site === 'youtube' ? 'Open YouTube' : a.site === 'google' ? 'Open Google' : 'Open website', result: 'Link ready.' };
    });
  def('spotify', "Spotify on the phone: play (query + kind: track, artist, album, playlist, liked; the user's own playlists by name), pause, resume, next, previous, volume (value 0-100), shuffle (value on/off), now_playing.",
    obj({ action: str('', ['play', 'pause', 'resume', 'next', 'previous', 'volume', 'shuffle', 'now_playing']), query: str(''), kind: str('', ['track', 'artist', 'album', 'playlist', 'liked']), value: str('') }, ['action']),
    async a => { const r = a.action === 'play' ? await EV.spotify.play(a.query, a.kind) : await EV.spotify.control(a.action, a.value);
      if (r.needs_tap && !r.label) r.label = 'Open Spotify'; ui().spotifyChanged(); return r; });

  /* ---------- routines ---------- */
  const DEFAULT_ROUTINES = [
    { name: 'study mode', steps: [{ tool: 'hero_mode', args: { action: 'start', minutes: 45 } }, { tool: 'my_tasks', args: { action: 'list' } }] },
    { name: 'sleep mode', steps: [{ tool: 'spotify', args: { action: 'pause' } }, { tool: 'ev_sleep', args: {} }] }];
  def('routine', 'Routines (several actions at once): run (name), list, create (name + steps [{tool, args}] using these tools), delete.',
    obj({ action: str('', ['run', 'list', 'create', 'delete']), name: str(''),
          steps: { type: A, items: { type: O, properties: { tool: { type: S }, args_json: { type: S, description: 'the tool arguments as a JSON object string' } } } } }, ['action']),
    async a => {
      const R = st.data.routines.length ? st.data.routines : DEFAULT_ROUTINES;
      if (a.action === 'list') return { routines: R.map(r => r.name) };
      if (a.action === 'create') {
        const steps = (a.steps || []).map(s => { let args = {}; try { args = JSON.parse(s.args_json || '{}'); } catch (e) {} return { tool: s.tool, args }; }).filter(s => REG[s.tool]);
        st.data.routines = [...R.filter(r => lc(r.name) !== lc(a.name)), { name: a.name, steps }]; st.save(); return { result: 'Routine saved with ' + steps.length + ' steps.' };
      }
      const r = R.find(r => lc(r.name) === lc(a.name)) || R.find(r => lc(r.name).includes(lc(a.name)));
      if (!r) return { error: 'No routine called ' + a.name + '.', routines: R.map(r => r.name) };
      if (a.action === 'delete') { st.data.routines = R.filter(x => x !== r); st.save(); return { result: 'Deleted.' }; }
      const done = []; for (const s of r.steps) { if (REG[s.tool] && s.tool !== 'routine') { const out = await run(s.tool, s.args || {}); done.push(s.tool + ': ' + (out.result || out.error || 'ok')); } }
      return { ran: r.name, steps: done };
    });

  /* ---------- running a tool ---------- */
  function normalize(t, args) {                // the model sometimes sends {"done": true} instead of {"action": "done"}
    const props = t.decl.parameters.properties || {}, out = {};
    for (const [k, v] of Object.entries(args || {})) {
      if (k in props || (k === '_image' && typeof v === 'string')) out[k] = v;      // _image: a photo the app itself passes in
      else if (props.action && props.action.enum && props.action.enum.includes(k) && v === true && !('action' in args)) out.action = k;
      else if (props.text && !('text' in args) && typeof v === 'string') out.text = v;
    }
    if (props.action && out.action && props.action.enum && !props.action.enum.includes(out.action)) {
      const a = lc(out.action).replace(/\s+/g, '_'); out.action = props.action.enum.find(e => e === a || a.includes(e) || e.includes(a)) || out.action;
    }
    return out;
  }
  async function run(name, args) {
    const t = REG[name];
    if (!t) return { error: 'Unknown tool ' + name };
    try { return (await t.run(normalize(t, args))) || { result: 'Done.' }; }
    catch (e) { if (e instanceof G.KeyError) throw e; return { error: e.message || String(e) }; }
  }
  const declarations = () => Object.values(REG).map(t => t.decl);

  EV.tools = { run, declarations, REG };
})();
