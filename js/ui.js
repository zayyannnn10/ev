/* Phone E.V. screen: the Spider Signal design, wired to the real assistant. Keeps the design's
   panels, motion and states, and adds listening, thinking, speaking, reminders, camera, files… */
(function () {
  const $ = id => document.getElementById(id);
  const st = EV.store, V = EV.voice, G = EV.gemini;
  const phone = document.querySelector('.phone'), app = document.querySelector('.app'), dial = document.querySelector('.dial');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.16,1,.3,1)';
  const anim = (el, f, o) => el && !RM() ? el.animate(f, o) : null;
  let lastAct = Date.now();
  const touch = () => { lastAct = Date.now(); };

  /* ================= small helpers ================= */
  let toastT;
  function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4200); }
  function applyPalette() { document.body.classList.toggle('dark', !!st.data.settings.palette); }
  function greet() {
    const h = new Date().getHours(), n = st.data.settings.name;
    const part = h < 5 ? 'Late night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night shift';
    document.querySelector('.greeting h2').innerHTML = `${esc(part)}${n ? ', ' + esc(n.split(' ')[0]) : ''}.<br><span>With great power.</span>`;
  }
  function clock() {
    const d = new Date();
    $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    $('date').innerHTML = d.toLocaleDateString('en', { weekday: 'long' }).toUpperCase() + '<br>' + d.toLocaleDateString('en', { day: 'numeric', month: 'short' }).toUpperCase();
  }

  /* ================= briefing: E.V.'s words + tap buttons ================= */
  function brief(text, opts = {}) {
    const p = $('briefText');
    p.className = opts.user ? 'user' : '';
    p.textContent = text;
    $('briefLabel').textContent = opts.label || (opts.user ? 'You' : 'E.V.');
    anim(p, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: ease });
  }
  function idleBrief() {
    const open = st.data.tasks.filter(t => !t.done), due = open.filter(t => t.due).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
    $('briefLabel').textContent = 'Mission briefing';
    const p = $('briefText'); p.className = '';
    p.innerHTML = open.length ? `${open.length} mission${open.length > 1 ? 's' : ''} on your radar.<br><em>${due ? 'Next: ' + esc(due.text) + ', ' + esc(fmtDue(due.due)) : 'Tap the mask and tell me what you need.'}</em>`
      : 'City is quiet. No missions.<br><em>Tap the mask and tell me what you need.</em>';
  }
  function offers(list) {
    const box = $('offers'); box.innerHTML = '';
    (list || []).forEach((o, i) => {
      const a = document.createElement(o.url ? 'a' : 'button');
      a.className = 'offer' + (i ? ' alt' : ''); a.textContent = o.label || 'Open';
      if (o.url) { a.href = o.url; a.rel = 'noopener'; if (/^https?:/.test(o.url)) a.target = '_blank'; a.onclick = () => setTimeout(() => offers([]), 400); }
      else a.onclick = () => runOfferAction(o);
      box.appendChild(a);
    });
  }
  function runOfferAction(o) {
    if (o.action === 'camera') return showCamera();
    if (o.action === 'pick_image') { pendingQuestion = o.question; return $('pickImg').click(); }
  }
  function fmtDue(iso) {
    const d = new Date(iso), now = new Date(), tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = d.toDateString() === now.toDateString() ? 'today' : d.toDateString() === new Date(Date.now() + 864e5).toDateString() ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return day + ' ' + tm;
  }

  /* ================= the mask: states ================= */
  let senseState = 'idle';
  const LABEL = { idle: 'SPIDEY SENSE', listening: 'LISTENING', thinking: 'THINKING', speaking: 'E.V.', sleeping: 'TAP TO WAKE' };
  const HINT = { idle: 'Tap the mask to talk', listening: 'Listening… tap to send', thinking: 'Working on it…', speaking: 'Tap the mask to interrupt', sleeping: 'Off duty. Tap the mask to wake.' };
  const AXIS = { idle: 'SENSE / READY', listening: 'SENSE / LIVE', thinking: 'SENSE / THINK', speaking: 'SENSE / TALK', sleeping: 'SENSE / SLEEP' };
  let zTimer = null;
  function setSense(next) {
    const prev = senseState; senseState = next;
    ['listening', 'sleeping', 'thinking', 'speaking'].forEach(c => phone.classList.toggle(c, c === next));
    const small = $('talk').querySelector('small');
    small.textContent = LABEL[next]; $('senseHint').textContent = HINT[next]; document.querySelector('.axis.right').textContent = AXIS[next];
    $('talk').setAttribute('aria-pressed', String(next === 'listening'));
    $('talk').setAttribute('aria-label', { idle: 'Talk to E.V.', listening: 'Send what you said', thinking: 'E.V. is working', speaking: 'Interrupt E.V.', sleeping: 'Wake E.V.' }[next]);
    $('sleepToggle').textContent = next === 'sleeping' ? '☀' : '☾';
    $('sleepToggle').setAttribute('aria-label', next === 'sleeping' ? 'Wake E.V.' : 'Put E.V. to sleep');
    if (prev === next) return;
    [small, $('senseHint'), document.querySelector('.axis.right')].forEach(el => anim(el, [{ opacity: 0, transform: (el.style.transform || '') + ' translateY(7px)', filter: 'blur(3px)' }, { opacity: 1, transform: el.style.transform || 'none', filter: 'blur(0)' }], { duration: 320, easing: ease }));
    if (next === 'sleeping' || prev === 'sleeping') anim($('sleepToggle'), [{ transform: 'rotate(-180deg) scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: ease });
    const mask = document.querySelector('.spider-mask'), eyes = document.querySelector('.mask-eyes');
    if (next === 'listening') {
      shockwave('#ff3553'); setTimeout(() => shockwave('#3f8bff'), 140);
      anim(document.querySelector('.web-art'), [{ opacity: .16 }, { opacity: .42 }, { opacity: .16 }], { duration: 900, easing: 'ease-out' });
      anim(eyes, [{ transform: 'scaleY(.15)' }, { transform: 'scaleY(1.25)' }, { transform: 'scaleY(1.1)' }], { duration: 420, easing: ease });
    } else if (next === 'sleeping') {
      anim(mask, [{ transform: 'translateY(0) rotate(0) scale(1)' }, { transform: 'translateY(-6px) rotate(3deg) scale(1.02)' }, { transform: 'translateY(10px) rotate(-7deg) scale(.92)' }], { duration: 700, easing: ease });
      clearInterval(zTimer); zTimer = setInterval(zz, 1300); setTimeout(zz, 500);
    } else if (prev === 'sleeping') {
      anim(eyes, [{ transform: 'scaleY(.09)' }, { transform: 'scaleY(1.2)' }, { transform: 'scaleY(1)' }], { duration: 480, easing: ease });
      shockwave('#6ca8ff');
    }
    if (next !== 'sleeping') clearInterval(zTimer);
  }
  function shockwave(color) {
    if (RM()) return; const s = document.createElement('span'); s.className = 'shock'; s.style.borderColor = color; dial.appendChild(s);
    s.animate([{ transform: 'scale(.75)', opacity: 1 }, { transform: 'scale(1.55)', opacity: 0 }], { duration: 760, easing: ease }).onfinish = () => s.remove();
  }
  function zz() {
    if (RM() || !phone.classList.contains('sleeping')) return;
    const r = dial.getBoundingClientRect(), p = phone.getBoundingClientRect(), z = document.createElement('span');
    z.className = 'zz'; z.textContent = Math.random() < .5 ? 'z' : 'Z';
    z.style.left = (r.left - p.left + r.width * .62 + Math.random() * 18) + 'px'; z.style.top = (r.top - p.top + r.height * .28) + 'px';
    phone.appendChild(z);
    z.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { opacity: .9, offset: .25 }, { transform: `translate(${18 + Math.random() * 16}px,-58px) scale(1.15)`, opacity: 0 }], { duration: 2600, easing: 'ease-out' }).onfinish = () => z.remove();
  }
  const tingle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tingle.setAttribute('class', 'tingle'); tingle.setAttribute('viewBox', '-160 -160 320 320'); tingle.setAttribute('aria-hidden', 'true');
  tingle.innerHTML = [-150, -115, -65, -30, 30, 150, 195, 210, -195, -90].map(deg => {
    const a = deg * Math.PI / 180; let d = '';
    for (let k = 0; k <= 4; k++) { const r = 128 + k * 9, off = (k % 2 ? 1 : -1) * 5; d += (k ? 'L' : 'M') + (Math.cos(a) * r - Math.sin(a) * off).toFixed(1) + ' ' + (Math.sin(a) * r + Math.cos(a) * off).toFixed(1); }
    return `<path d="${d}"/>`;
  }).join('');
  dial.appendChild(tingle);
  const bars = [...document.querySelectorAll('.listen-bars i')];
  function level(v) { bars.forEach((b, i) => b.style.setProperty('--lvl', Math.max(.15, Math.min(1, v * (0.6 + 0.8 * Math.abs(Math.sin(i * 1.7 + Date.now() / 140))))).toFixed(2))); }

  /* ================= talking ================= */
  let rec = null, busy = false, pendingQuestion = '', convoFollow = false, askId = 0;
  const micOn = () => st.data.settings.mic !== false;
  function renderMic() {
    const b = $('micToggle'); if (!b) return;
    b.classList.toggle('off', !micOn()); b.setAttribute('aria-pressed', String(micOn()));
    b.setAttribute('aria-label', micOn() ? 'Microphone on. Tap to switch it off' : 'Microphone off. Tap to switch it on');
  }
  async function startListening(follow) {
    V.unlock(); V.stop(); touch();
    if (!micOn()) { toast("The mic is off. Type below, or tap the mic button at the top to switch it on."); $('message').focus(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot use the microphone. Type instead.'); return; }
    setSense('listening'); offers([]);
    rec = new V.Recorder({ onLevel: level, waitMs: follow ? 6000 : 9000 });
    let got;
    try { got = await rec.start(); }
    catch (e) { rec = null; setSense('idle'); EV.log('mic: ' + e.name + ' ' + e.message);
      brief(e.name === 'NotAllowedError' ? 'I need the microphone. Allow it in Settings → E.V. (or tap the mask again and press Allow).' : 'The microphone did not start: ' + e.message); return; }
    rec = null;
    if (!got) { setSense('idle'); if (follow) idleBrief(); else brief("Didn't catch anything. Tap the mask and try again."); return; }
    EV.log(`heard ${got.seconds.toFixed(1)}s of speech`);
    // the brain gets the recording straight away; your words are written down at the same time (for the screen and history)
    const transcript = G.transcribe(got.b64).then(t => { if (t && senseState === 'thinking') brief('“' + t + '”', { user: true }); return t; });
    transcript.catch(() => {});
    ask('', null, { audio: got.b64, transcript });
  }
  function stopListening() { if (rec) rec.stop(); }
  function withTimeout(p, ms, msg) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  }
  async function ask(text, images, voice) {
    if (busy) { V.stop(); }
    const id = ++askId;
    busy = true; touch(); convoFollow = false;
    if (text) brief('“' + text + '”', { user: true }); else if (voice) brief('…', { user: true });
    setSense('thinking'); offers([]); $('senseHint').textContent = 'Thinking…';
    EV.log('ask: ' + (text || (voice ? '(voice)' : '(picture)')).slice(0, 80));
    try {
      // E.V. never sits on "working on it" forever: after 90 s it gives up and says so
      const r = await withTimeout(EV.agent.run({ text, images, audio: voice && voice.audio, transcript: voice && voice.transcript }, { onTool: name => { EV.log('tool: ' + name); if (id === askId) $('senseHint').textContent = toolLabel(name); } }),
        90000, "That took too long, so I stopped. Try again, or ask it a simpler way.");
      if (id !== askId) return;
      busy = false;
      EV.log('reply: ' + (r.reply || '').slice(0, 80));
      await say(r.reply || 'Done.', r.offers);
      if (id !== askId) return;
      if (r.offers.length === 1 && r.offers[0].url && /^(https:\/\/wa\.me|sms:|tel:|mailto:|https:\/\/maps\.apple)/.test(r.offers[0].url)) {
        setTimeout(() => { try { location.href = r.offers[0].url; } catch (e) {} }, 300);       // opens straight away; the button stays
      }
      // hands-free: with the mic on, E.V. keeps listening for your answer (stops by itself if you say nothing)
      if (micOn() && st.data.settings.handsFree !== false && senseState === 'idle' && !r.offers.length && document.visibilityState === 'visible') {
        convoFollow = true; setTimeout(() => { if (senseState === 'idle' && convoFollow) startListening(true); }, 450);
      }
    } catch (e) { if (id === askId) { busy = false; EV.log('failed: ' + e.message); fail(e); } }
  }
  function toolLabel(n) {
    return { my_tasks: 'Updating missions…', web_search: 'Searching the web…', news: 'Fetching the news…', research: 'Starting research…', presentation: 'Making slides…',
      mindmap: 'Drawing a mind map…', camera: 'Looking…', spotify: 'Talking to Spotify…', send_whatsapp: 'Writing the message…', create_pdf: 'Writing the PDF…',
      prayer_times: 'Checking prayer times…', memory: 'Remembering…' }[n] || 'Working on it…';
  }
  function fail(e) {
    busy = false; setSense('idle');
    if (e instanceof G.KeyError) { brief(e.message + ' Open Settings to fix the key.'); showSettings(); return; }
    brief(e.message || String(e)); V.speak(e.message || 'Something went wrong.');
  }
  function say(text, offs) {
    brief(text, { label: 'E.V.' }); offers(offs || []);
    setSense('speaking');
    return V.speak(text, { onend: () => { if (senseState === 'speaking') setSense('idle'); touch(); } });
  }
  let announceQ = [];
  function announce(text) {                       // jobs finishing, reminders: speak when E.V. is free
    if (isOff()) return;
    announceQ.push(text);
    const go = () => { if (busy || rec || senseState === 'speaking' || senseState === 'thinking') return setTimeout(go, 1500); const t = announceQ.shift(); if (!t) return;
      if (senseState === 'sleeping') { toast(t); return; } EV.agent.remember('ev', t); say(t); };
    go();
  }

  /* ================= sheets (the design's panels) ================= */
  let panelRevision = 0, panelAnimation = null, lastFocus = null, sheetName = '';
  function open(title, html, name) {
    const overlay = $('overlay'), sheet = overlay.querySelector('.sheet'), already = !overlay.hidden;
    ++panelRevision; panelAnimation?.cancel(); sheet.getAnimations().forEach(a => a.cancel()); overlay.getAnimations().forEach(a => a.cancel());
    if (!already) lastFocus = document.activeElement;
    sheetName = name || '';
    $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; overlay.hidden = false;
    phone.classList.add('panel-open'); app.inert = true;
    if (!already) { anim(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }); panelAnimation = anim(sheet, [{ transform: 'translateY(100%)', opacity: .5 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 380, easing: ease }); }
    if (!RM()) {
      anim($('sheetTitle'), [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: ease });
      [...$('sheetBody').children].slice(0, 12).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60 + i * 45, easing: ease, fill: 'backwards' }));
    }
  }
  function close() {
    const overlay = $('overlay'); if (overlay.hidden) return;
    const revision = ++panelRevision, sheet = overlay.querySelector('.sheet');
    panelAnimation?.cancel(); phone.classList.remove('panel-open');
    if (sheetName === 'camera') camera.close();
    sheetName = '';
    const fin = () => { if (revision !== panelRevision) return; overlay.hidden = true; app.inert = false; lastFocus?.focus?.(); };
    anim(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 230, easing: 'ease-in' });
    panelAnimation = anim(sheet, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: 230, easing: 'cubic-bezier(.4,0,1,1)' });
    panelAnimation ? panelAnimation.finished.then(fin).catch(() => {}) : fin();
    setNav('homeNav');
  }
  $('close').onclick = close;
  $('overlay').onclick = e => { if (e.target === $('overlay')) close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('overlay').hidden) close(); });

  /* nav: sliding pill */
  const nav = document.querySelector('.nav'), pill = document.createElement('span'); pill.className = 'nav-pill'; nav.prepend(pill);
  function setNav(id) {
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.id === id));
    const b = $(id), nr = nav.getBoundingClientRect(), br = b.getBoundingClientRect();
    if (br.width) { pill.style.left = (br.left - nr.left - 4) + 'px'; pill.style.width = (br.width + 8) + 'px'; }
  }
  addEventListener('resize', () => setNav(nav.querySelector('.active')?.id || 'homeNav'));

  /* ---------- missions ---------- */
  function showTasks() {
    open('Your mission board.', `<p>Every hero starts somewhere. Pick your next mission.</p><div id="taskList"></div>
      <form class="task-form due-form" id="addTask"><input id="newTask" aria-label="New mission" placeholder="One more thing…" maxlength="160" required>
      <button>Add</button><input type="datetime-local" id="newDue" aria-label="Due (optional)"></form>
      <p style="font-size:12px">Reminders ring while E.V. is open. E.V. nags about late missions every ${st.data.settings.remindEvery} minutes.</p>`, 'tasks');
    renderTasks();
    $('addTask').onsubmit = e => {
      e.preventDefault(); const text = $('newTask').value.trim(); if (!text) return;
      const due = $('newDue').value ? new Date($('newDue').value).toISOString() : null;
      st.data.tasks.unshift({ id: st.uid(), text, done: false, due, created: Date.now() }); st.save();
      $('newTask').value = ''; $('newDue').value = ''; renderTasks(true); tasksChanged();
    };
  }
  function renderTasks(added) {
    const L = $('taskList'); if (!L) return;
    const T = [...st.data.tasks].sort((a, b) => (a.done - b.done) || ((a.due ? new Date(a.due) : 9e15) - (b.due ? new Date(b.due) : 9e15)));
    L.innerHTML = T.length ? T.slice(0, 60).map(t => `<label class="task" data-id="${t.id}"><input type="checkbox" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span>
      ${t.due && !t.done ? `<em class="due ${new Date(t.due) < new Date() ? 'late' : ''}">${esc(fmtDue(t.due))}</em>` : ''}<button class="x" type="button" aria-label="Delete">×</button></label>`).join('')
      : '<div class="empty">No missions. Suspiciously peaceful.</div>';
    if (added) anim(L.firstElementChild, [{ opacity: 0, transform: 'translateX(30px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: ease });
    L.onchange = e => { const id = e.target.closest('.task')?.dataset.id, t = st.data.tasks.find(x => x.id === id); if (!t) return;
      t.done = e.target.checked; t.doneAt = Date.now(); st.save(); tasksChanged();
      if (t.done) { const row = e.target.closest('.task'), r = row.getBoundingClientRect(), c = e.target.getBoundingClientRect(); burst(row, c.left - r.left + c.width / 2, c.top - r.top + c.height / 2, 90, '#ff3553'); } };
    L.onclick = e => { if (!e.target.classList.contains('x')) return; e.preventDefault(); const id = e.target.closest('.task').dataset.id;
      st.data.tasks = st.data.tasks.filter(x => x.id !== id); st.save(); renderTasks(); tasksChanged(); };
  }
  function tasksChanged() {
    const n = st.data.tasks.filter(t => !t.done).length;
    $('taskCount').textContent = n ? `${n} mission${n === 1 ? '' : 's'} on your radar` : 'City saved. All missions complete.';
    anim($('taskCount'), [{ transform: 'translateY(-5px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: ease });
    if (sheetName === 'tasks') renderTasks();
    if (senseState === 'idle' && $('briefLabel').textContent === 'Mission briefing') idleBrief();
  }
  $('tasks').onclick = () => { setNav('homeNav'); showTasks(); };

  /* ---------- hero mode (focus) ---------- */
  let focusEnd = null, remaining = 1500, duration = 25;
  const fbar = document.createElement('span'); fbar.className = 'fbar'; $('focus').appendChild(fbar);
  function time() { const s = focusEnd ? Math.max(0, Math.ceil((focusEnd - Date.now()) / 1000)) : remaining; return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function showFocus() {
    open('Suit up. Focus in.', `<p>Pick one thing. Give it your full attention.</p><div class="focus-time" id="timer" aria-live="off">${time()}</div>
      <div class="options">${[15, 25, 45].map(n => `<button data-min="${n}" class="${duration === n ? 'selected' : ''}">${n} min</button>`).join('')}</div>
      <button class="primary" id="startFocus">${focusEnd ? 'Pause session' : remaining === 0 ? 'Start again' : 'Start focus'}</button><button class="primary" id="resetFocus">Reset</button>
      <p>E.V. tells you when the time is up, as long as it's open.</p>`, 'focus');
    document.querySelectorAll('[data-min]').forEach(b => b.onclick = () => { duration = +b.dataset.min; focusEnd = null; remaining = duration * 60; showFocus(); });
    $('startFocus').onclick = () => { if (focusEnd) { remaining = Math.max(0, Math.ceil((focusEnd - Date.now()) / 1000)); focusEnd = null; } else { if (!remaining) remaining = duration * 60; focusEnd = Date.now() + remaining * 1000; } showFocus(); };
    $('resetFocus').onclick = () => { focusEnd = null; remaining = duration * 60; showFocus(); };
  }
  function hero(action, minutes) {
    if (action === 'start') { duration = Math.max(1, Math.min(180, +minutes || 25)); remaining = duration * 60; focusEnd = Date.now() + remaining * 1000; return { result: `Hero mode on: ${duration} minutes.` }; }
    if (action === 'stop') { focusEnd = null; remaining = duration * 60; return { result: 'Hero mode off.' }; }
    return focusEnd ? { running: true, left: time() } : { running: false };
  }
  setInterval(() => {
    if (focusEnd && Date.now() >= focusEnd) { focusEnd = null; remaining = 0; announce('Time. Hero mode done. Take a break, you earned it. Probably.'); try { navigator.vibrate?.([200, 100, 200]); } catch (e) {} }
    if ($('timer')) $('timer').textContent = time();
    $('focusSummary').textContent = focusEnd ? time() + ' · In your zone' : remaining === 0 ? 'Session complete. Breathe.' : duration + ' minutes. Hero mode.';
    $('focus').classList.toggle('running', !!focusEnd);
    const total = duration * 60, left = focusEnd ? Math.max(0, (focusEnd - Date.now()) / 1000) : remaining;
    fbar.style.width = (focusEnd || left < total ? Math.min(100, (1 - left / total) * 100) : 0) + '%';
  }, 1000);
  $('focus').onclick = () => { setNav('homeNav'); showFocus(); };

  /* ---------- timers ---------- */
  const timers = [];
  function timer(action, minutes, label) {
    if (action === 'set') { const t = { id: st.uid(), label: label || 'Timer', end: Date.now() + (+minutes || 1) * 6e4 }; timers.push(t); return { result: `${t.label} set for ${minutes} minute${minutes == 1 ? '' : 's'}.` }; }
    if (action === 'cancel') { const i = timers.findIndex(t => !label || t.label.toLowerCase().includes(String(label).toLowerCase())); if (i < 0) return { error: 'No timer like that.' }; timers.splice(i, 1); return { result: 'Timer cancelled.' }; }
    return { timers: timers.map(t => t.label + ': ' + Math.ceil((t.end - Date.now()) / 6e4) + ' min left') };
  }

  /* ---------- comms (chat) ---------- */
  function showChat(typingFor) {
    const H = st.data.chat.slice(-30);
    open('Open comms.', `${H.length ? H.map(m => `<div class="bubble ${m.role === 'user' ? 'user' : ''}">${esc(m.text)}</div>`).join('') : '<div class="bubble">Hello, I\'m E.V. Start with whatever is on your mind.</div>'}
      ${typingFor ? '<div class="bubble typing"><i></i><i></i><i></i></div>' : ''}
      <form class="task-form" id="chatForm"><input id="chatInput" aria-label="Message E.V." placeholder="Keep the thought going…" maxlength="2000" required><button>Send</button></form>
      <p style="font-size:12px">Chat is kept on this phone only.</p>`, 'chat');
    $('chatForm').onsubmit = async e => {
      e.preventDefault(); const q = $('chatInput').value.trim(); if (!q) return; $('chatInput').value = '';
      showChatPending(q);
    };
    setTimeout(() => $('sheetBody').querySelector('.task-form')?.scrollIntoView({ block: 'end' }), 60);
  }
  async function showChatPending(q) {
    const body = $('sheetBody'), form = $('chatForm');
    const u = document.createElement('div'); u.className = 'bubble user'; u.textContent = q; body.insertBefore(u, form);
    const t = document.createElement('div'); t.className = 'bubble typing'; t.innerHTML = '<i></i><i></i><i></i>'; body.insertBefore(t, form);
    form.scrollIntoView({ block: 'end' });
    await ask(q);
    if (sheetName === 'chat') { t.classList.remove('typing'); t.textContent = st.data.chat.at(-1)?.text || ''; form.scrollIntoView({ block: 'end' }); }
  }
  $('notesNav').onclick = () => { setNav('notesNav'); showChat(); };
  $('homeNav').onclick = close;

  /* ---------- camera ---------- */
  const camera = {
    stream: null,
    async open() {
      if (this.stream) return true;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (sheetName !== 'camera') showCamera(true);
        ['camSharp', 'camSoft'].forEach(id => { const v = $(id); if (v) { v.srcObject = this.stream; v.play().catch(() => {}); } });
        return true;
      } catch (e) { this.stream = null; return false; }
    },
    close() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());       // the camera light goes off
      this.stream = null;
    },
    async capture() {
      if (!this.stream && !(await this.open())) return null;
      const v = $('camSharp'); if (!v) return null;
      for (let i = 0; i < 20 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 100));
      if (!v.videoWidth) return null;
      await new Promise(r => setTimeout(r, 350));
      const c = document.createElement('canvas'); const k = Math.min(1, 1280 / v.videoWidth); c.width = v.videoWidth * k; c.height = v.videoHeight * k;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const f = $('camFlash'); if (f) { f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop'); }
      return c.toDataURL('image/jpeg', .85).split(',')[1];
    }
  };
  function showCamera(fromOpen) {
    open('Look sharp.', `<div class="cam" id="camBox"><video class="soft" id="camSoft" muted playsinline autoplay></video><video class="sharp" id="camSharp" muted playsinline autoplay></video>
      <div class="tag"><i></i>CAMERA</div><div class="flash" id="camFlash"></div></div>
      <div class="btns2"><button class="pri" id="camWhat">What's this?</button><button id="camRead">Read this page</button><button id="camPick">Choose a picture</button><button id="camOff">Close</button></div>`, 'camera');
    $('camWhat').onclick = () => ask('What is this I am showing you?');
    $('camRead').onclick = () => ask('Read this page for me and save it as a note.');
    $('camPick').onclick = () => { pendingQuestion = ''; $('pickImg').click(); };
    $('camOff').onclick = close;
    if (!fromOpen) camera.open().then(ok => { if (!ok) $('camBox').innerHTML = '<div class="cam-off">Camera blocked. Allow it in Settings → E.V. → Camera, then try again.</div>'; });
    else ['camSharp', 'camSoft'].forEach(id => { $(id).srcObject = camera.stream; $(id).play().catch(() => {}); });
  }
  $('pickImg').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const b64 = await shrink(f); close();
    ask(pendingQuestion || 'Look at this picture and tell me what matters in it. If it is a screenshot, read it and tell me what I am looking at.', [{ b64, mime: 'image/jpeg' }]);
  };
  function shrink(file) {
    return new Promise((res, rej) => { const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .85).split(',')[1]); };
      img.onerror = rej; img.src = url; });
  }

  /* ---------- news ---------- */
  function showNews(d) {
    open('The Daily Bugle.', `<p>${esc(d.topic)} · tap a story to read it.</p>` + (d.stories.length ? d.stories.map(s =>
      `<div class="card"><small>${esc(s.source)}</small><b>${esc(s.title)}</b><p>${esc(s.summary)}</p>${s.url ? `<div class="acts"><a class="mini" href="${esc(s.url)}" target="_blank" rel="noopener">Read</a></div>` : ''}</div>`).join('')
      : '<div class="empty">No stories came back. Try again in a minute.</div>'), 'news');
  }

  /* ---------- spotify ---------- */
  async function showSpotify() {
    const c = EV.spotify.connected();
    open('Soundtrack.', `<div class="np" id="np"><div class="art"></div><div><b>${c ? 'Checking…' : 'Spotify not connected'}</b><span>${c ? '' : 'Connect it from the laptop install page, or use the box below to open Spotify.'}</span></div></div>
      <div class="controls"><button id="spPrev" aria-label="Previous">⏮</button><button class="big" id="spPlay" aria-label="Play or pause">⏯</button><button id="spNext" aria-label="Next">⏭</button></div>
      <form class="task-form" id="spForm"><input id="spQ" placeholder="Play… (song, artist, my gym playlist)" required><button>Play</button></form>`, 'spotify');
    const ctl = async a => { try { const r = await EV.spotify.control(a); if (r.needs_tap) offers([{ label: r.label || 'Open Spotify', url: r.open }]); toast(r.result || r.error); spotifyChanged(); } catch (e) { toast(e.message); } };
    $('spPrev').onclick = () => ctl('previous'); $('spNext').onclick = () => ctl('next');
    $('spPlay').onclick = async () => { const n = c ? await EV.spotify.nowPlaying().catch(() => ({})) : {}; ctl(n.playing ? 'pause' : 'resume'); };
    $('spForm').onsubmit = e => { e.preventDefault(); const q = $('spQ').value.trim(); if (q) { close(); ask('Play ' + q + ' on Spotify'); } };
    spotifyChanged();
  }
  async function spotifyChanged() {
    if (sheetName !== 'spotify' || !EV.spotify.connected()) return;
    try { const n = await EV.spotify.nowPlaying(); const box = $('np'); if (!box) return;
      box.innerHTML = `${n.art ? `<img src="${esc(n.art)}" alt="">` : '<div class="art"></div>'}<div><b>${esc(n.track || 'Nothing playing')}</b><span>${esc(n.artist || 'Ask me to play something')}</span></div>`;
    } catch (e) {}
  }
  setInterval(() => sheetName === 'spotify' && spotifyChanged(), 8000);

  /* ---------- files and jobs ---------- */
  const jobs = [];
  function job(title) {
    const j = { id: st.uid(), title, p: 0, detail: 'Starting', state: 'running', cancelled: false,
      update(p, d) { j.p = p; j.detail = d || j.detail; render(); }, done(d) { j.state = 'done'; j.p = 1; j.detail = d; render(); setTimeout(() => { jobs.splice(jobs.indexOf(j), 1); render(); }, 60000); },
      fail(msg) { j.state = 'failed'; j.detail = msg; render(); announce(title + ' failed: ' + msg); } };
    const render = () => { renderJobs(); if (sheetName === 'files') renderFiles(); };
    jobs.unshift(j); render(); return j;
  }
  function renderJobs() {
    const run = jobs.filter(j => j.state === 'running').length, el = $('jobChip');
    el.hidden = !run; el.innerHTML = `<i></i>${run} job${run > 1 ? 's' : ''} running · Files`;
  }
  function showFiles() { open('Your stash.', '<div id="fileList"></div><div class="btns2"><button class="pri" id="mkPdf">Photos → one PDF</button><button id="fRefresh">Refresh</button></div>', 'files'); renderFiles();
    $('mkPdf').onclick = () => $('pickConv').click(); $('fRefresh').onclick = renderFiles; }
  function renderFiles() {
    const L = $('fileList'); if (!L) return;
    const J = jobs.map(j => `<div class="card"><small>${j.state === 'running' ? 'Working' : j.state === 'done' ? 'Done' : 'Failed'}</small><b>${esc(j.title)}</b><p>${esc(j.detail)}</p>${j.state === 'running' ? `<div class="prog"><i style="width:${Math.round(j.p * 100)}%"></i></div>` : ''}</div>`).join('');
    const F = st.files.list();
    L.innerHTML = J + (F.length ? F.map(f => { const ext = (f.name.split('.').pop() || '').toLowerCase();
      return `<div class="file" data-id="${f.id}"><span class="ic ${ext}">${ext.toUpperCase()}</span><span class="nm"><b>${esc(f.name)}</b><small>${new Date(f.created).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${Math.max(1, Math.round(f.size / 1024))} KB</small></span>
        <button class="mini red" data-a="share">Share</button><button class="mini" data-a="del" aria-label="Delete">×</button></div>`; }).join('') : (J ? '' : '<div class="empty">Nothing yet. Ask for a presentation, a mind map, a PDF or some research.</div>'));
    L.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return; const id = b.closest('.file').dataset.id;
      if (b.dataset.a === 'del') { await st.files.del(id); renderFiles(); return; }
      const rec = await st.files.get(id); if (!rec) return;
      const file = new File([rec.blob], rec.name, { type: rec.type || rec.blob.type });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: rec.name });
            else { const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = rec.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); } }
      catch (e2) { if (e2.name !== 'AbortError') toast('Sharing failed: ' + e2.message); }
    };
  }
  $('pickConv').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    try { const out = await EV.docs.imagesToPdf(files, 'Photos'); await st.files.put(out.name, out.blob, 'pdf'); renderFiles(); toast('Made ' + out.name); }
    catch (er) { toast('Could not make the PDF: ' + er.message); }
  };
  function filesChanged() { if (sheetName === 'files') renderFiles(); }

  /* ---------- expenses ---------- */
  function showExpenses(d) {
    const m = (d && d.month) || new Date().toISOString().slice(0, 7), list = st.data.expenses.filter(x => x.date.startsWith(m)), by = {};
    list.forEach(x => by[x.category] = (by[x.category] || 0) + x.amount);
    const total = list.reduce((s, x) => s + x.amount, 0), max = Math.max(1, ...Object.values(by));
    open('Money talks.', `<p>${new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p><div class="total">${total.toLocaleString()}</div>
      <div class="bars">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${Math.round(v / max * 100)}%"></i><span>${v.toLocaleString()}</span></div>`).join('') || '<div class="empty">Nothing spent this month. Impressive, or suspicious.</div>'}</div>`, 'expenses');
  }

  /* ---------- lecture recording ---------- */
  let lec = null;
  function lecture(action, title) {
    if (action === 'status') return lec ? { recording: true, minutes: Math.round((Date.now() - lec.t0) / 6e4) } : { recording: false };
    if (action === 'start') {
      if (lec) return { result: 'Already recording.' };
      lec = { title: title || 'Lecture ' + new Date().toLocaleDateString('en-GB'), t0: Date.now(), parts: [], pending: [] };
      const r = new V.Recorder({ vad: false, maxMs: 3 * 3600e3, chunkMs: 240000,
        onChunk: b64 => lec && lec.pending.push(G.transcribe(b64).then(t => lec && lec.parts.push(t)).catch(() => {})) });
      lec.rec = r; r.start().catch(e => { toast('Recording failed: ' + e.message); lec = null; $('recPill').hidden = true; });
      try { navigator.wakeLock?.request('screen').then(w => lec && (lec.wake = w)).catch(() => {}); } catch (e) {}
      $('recPill').hidden = false;
      return { result: 'Recording. Keep E.V. open with the screen on; I keep the screen awake if the phone lets me.' };
    }
    if (!lec) return { error: 'Not recording.' };
    const L = lec; lec = null; $('recPill').hidden = true; L.rec.stop(); try { L.wake?.release(); } catch (e) {}
    const j = job('Lecture notes: ' + L.title);
    (async () => {
      try {
        await new Promise(r => setTimeout(r, 600)); await Promise.all(L.pending);
        const transcript = L.parts.join('\n').trim();
        if (!transcript) return j.fail('No speech was recorded.');
        j.update(.6, 'Writing the summary');
        const doc = await G.ask(`These are transcribed lecture/meeting recordings titled "${L.title}". Write study notes.
Return JSON {"summary": str (3 spoken sentences), "sections": [{"heading": str, "paragraphs": [str], "bullets": [str]}]} with sections: Summary, Key points, Action items, Questions to review.\n\n${transcript.slice(0, 80000)}`, { json: true });
        st.data.notes.unshift({ id: st.uid(), title: L.title, text: transcript, t: Date.now() }); st.save();
        const out = await EV.docs.pdf({ title: L.title, subtitle: 'Lecture notes by E.V.', sections: doc.sections });
        await st.files.put(out.name, out.blob, 'pdf'); filesChanged();
        j.done('Notes ready: ' + out.name); announce('Your notes for ' + L.title + ' are ready. ' + (doc.summary || ''));
      } catch (e) { j.fail(e.message); }
    })();
    return { result: 'Stopped recording. Writing the notes now.' };
  }
  $('recStop').onclick = () => { const r = lecture('stop'); toast(r.result || r.error); };

  /* ---------- diagnostics ---------- */
  function showDiagnostics() {
    const lines = EV.logs(), voices = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(v => /^ava/i.test(v.name)).map(v => v.name).join(', ') || 'none found';
    const head = `Phone E.V. ${EV.VERSION} · voice: ${V.speakingWith()} · Ava voices: ${voices} · online: ${navigator.onLine}`;
    open('Under the mask.', `<p>${esc(head)}</p><pre id="diagText" style="white-space:pre-wrap;font-size:11px;line-height:1.5;background:#080e1d;border:1px solid #344564;border-radius:12px;padding:12px;max-height:46vh;overflow:auto;user-select:text;-webkit-user-select:text">${esc(lines.slice(-60).join('\n') || 'Nothing yet.')}</pre>
      <div class="btns2"><button class="pri" id="dCopy" type="button">Copy</button><button id="dVoice" type="button">Test both voices</button></div>`, 'diag');
    $('dCopy').onclick = async () => { const t = head + '\n' + lines.join('\n');
      try { await navigator.clipboard.writeText(t); toast('Copied. Paste it to Claude on the laptop.'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('diagText')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selected. Tap Copy in the menu.'); } };
    $('dVoice').onclick = async () => {
      V.unlock(); const keep = st.data.settings.voiceEngine;
      st.data.settings.voiceEngine = 'ava'; await V.speak('This is Ava, the iPhone voice.');
      st.data.settings.voiceEngine = 'gemini'; await V.speak('And this is the Gemini voice.');
      st.data.settings.voiceEngine = keep; st.save(); showDiagnostics();
    };
  }

  /* ---------- settings / about ---------- */
  function showSettings() {
    const s = st.data.settings, key = st.key.get();
    open('Make it yours.', `
      <div class="row"><span>Your name<small>What E.V. calls you</small></span><input id="sName" value="${esc(s.name)}" style="background:#080e1d;border:1px solid #344564;color:#eff4ff;border-radius:10px;padding:8px 10px;font-size:15px;max-width:48%"></div>
      <div class="row"><span>Voice speed<small>${esc(V.voiceName())} · <b id="sRateOut">${(+s.rate).toFixed(2)}×</b></small></span><input type="range" id="sRate" min="0.8" max="1.6" step="0.05" value="${s.rate}"></div>
      <div class="row"><span>E.V.'s voice<small id="sVoiceNow">${(s.voiceEngine || 'live') === 'live' ? 'Gemini Live: the laptop voice, no extra delay' : 'Now speaking with: ' + (V.speakingWith() === 'gemini' ? 'Gemini voice' : esc(V.voiceName()))}</small></span>
        <select id="sEngine"><option value="live" ${(s.voiceEngine || 'live') === 'live' ? 'selected' : ''}>Gemini Live (laptop voice)</option><option value="auto" ${s.voiceEngine === 'auto' ? 'selected' : ''}>Ava, Gemini backup</option><option value="ava" ${s.voiceEngine === 'ava' ? 'selected' : ''}>Ava (iPhone)</option><option value="gemini" ${s.voiceEngine === 'gemini' ? 'selected' : ''}>Gemini voice (slower)</option></select></div>
      <div class="row"><span>Hear it<small>Silent? Flip the ring/silent switch to ring.</small></span><button class="mini red" id="sTest" type="button">Test voice</button></div>
      <label class="toggle-row">Microphone<input id="sMic" type="checkbox" ${micOn() ? 'checked' : ''}></label>
      <label class="toggle-row">Keep listening after E.V. answers<input id="sHands" type="checkbox" ${s.handsFree !== false ? 'checked' : ''}></label>
      <div class="row"><span>Language<small>English unless you say otherwise</small></span><input id="sLang" value="${esc(s.language)}" style="background:#080e1d;border:1px solid #344564;color:#eff4ff;border-radius:10px;padding:8px 10px;font-size:15px;max-width:48%"></div>
      <label class="toggle-row">Symbiote palette<input id="darkToggle" type="checkbox" ${s.palette ? 'checked' : ''}></label>
      <div class="row"><span>Nag about late missions<small>minutes</small></span><input type="number" id="sNag" min="5" max="240" value="${s.remindEvery}"></div>
      <div class="row"><span>Fall asleep after<small>minutes of quiet (0 = never)</small></span><input type="number" id="sSleep" min="0" max="120" value="${s.autoSleep}"></div>
      <div class="sect">Brain</div>
      <div class="row"><span>Gemini key<small>${key ? 'Saved on this phone · ends …' + esc(key.slice(-4)) : 'Not set'}</small></span><button class="mini" id="sKey" type="button">Change</button></div>
      <div class="sect">From the laptop (one time)</div>
      <div class="row"><span>Copy name, contacts, Spotify<small>Laptop on, same Wi-Fi, 6-digit code from the install page</small></span><button class="mini" id="sImport" type="button">Enter code</button></div>
      <div class="row"><span>Spotify<small>${EV.spotify.connected() ? 'Connected on this phone' : 'Not connected'}</small></span><button class="mini" id="sSpot" type="button">${EV.spotify.connected() ? 'Disconnect' : 'How to connect'}</button></div>
      <div class="sect">Contacts</div><div id="cList"></div>
      <form class="task-form" id="cAdd"><input id="cName" placeholder="Name" required><input id="cNum" placeholder="+92…" inputmode="tel" required><button>Add</button></form>
      <div class="sect">Backup</div>
      <div class="btns2"><button id="bExp" type="button">Export backup</button><button id="bImp" type="button">Import backup</button></div>
      <div class="sect">App</div>
      <div class="row"><span>Updates<small id="uState">Phone E.V. ${esc(EV.VERSION)}</small></span><button class="mini" id="sUpd" type="button">Check</button></div>
      <div class="row"><span>Diagnostics<small>What happened recently. Copy it if something goes wrong.</small></span><button class="mini" id="sDiag" type="button">Open</button></div>`, 'settings');
    $('sEngine').onchange = e => { s.voiceEngine = e.target.value; V.resetAva(); st.save(); if (liveOn && s.voiceEngine !== 'live') EV.live.close('settings');
      $('sVoiceNow').textContent = s.voiceEngine === 'live' ? 'Gemini Live: the laptop voice, no extra delay' : 'Now speaking with: ' + (V.speakingWith() === 'gemini' ? 'Gemini voice' : V.voiceName()); };
    $('sMic').onchange = e => { s.mic = e.target.checked; st.save(); renderMic(); };
    $('sHands').onchange = e => { s.handsFree = e.target.checked; st.save(); };
    $('sDiag').onclick = showDiagnostics;
    const save = () => { st.save(); greet(); };
    $('sName').onchange = e => { s.name = e.target.value.trim(); save(); };
    $('sRate').oninput = e => { s.rate = +e.target.value; $('sRateOut').textContent = s.rate.toFixed(2) + '×'; save(); };
    $('sTest').onclick = () => { V.unlock(); V.speak("This is me at your speed. Fast enough, or do you want me to slow down for you?"); };
    $('sLang').onchange = e => { s.language = e.target.value.trim() || 'English'; save(); };
    $('darkToggle').onchange = e => symbiote(e.target);
    $('sNag').onchange = e => { s.remindEvery = Math.max(5, +e.target.value || 30); save(); };
    $('sSleep').onchange = e => { s.autoSleep = Math.max(0, +e.target.value || 0); save(); };
    $('sKey').onclick = () => showSetup(true);
    $('sImport').onclick = () => importFromLaptop();
    $('sSpot').onclick = () => { if (EV.spotify.connected()) { st.data.spotify = null; save(); showSettings(); toast('Spotify disconnected on the phone.'); }
      else open('Connect Spotify.', '<p>On the laptop, say <b>"Hey E.V., connect Spotify for my phone"</b> and log in. Then open the install page on the laptop and type its 6-digit code here under <b>Copy name, contacts, Spotify</b>.</p>', 'help'); };
    const renderC = () => { $('cList').innerHTML = st.data.contacts.length ? st.data.contacts.map((c, i) => `<div class="row"><span>${esc(c.name)}<small>${esc(c.number || c.email || '')}</small></span><button class="mini" data-i="${i}" type="button">Remove</button></div>`).join('') : '<div class="empty">No contacts yet.</div>';
      $('cList').onclick = e => { const i = e.target.dataset.i; if (i == null) return; st.data.contacts.splice(+i, 1); save(); renderC(); }; };
    renderC();
    $('cAdd').onsubmit = e => { e.preventDefault(); st.data.contacts.push({ name: $('cName').value.trim(), number: $('cNum').value.trim(), email: '', aliases: [] }); $('cName').value = $('cNum').value = ''; save(); renderC(); };
    $('bExp').onclick = async () => { const f = new File([st.exportJSON()], 'EV-phone-backup-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' });
      try { if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'E.V. backup' }); else { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); } } catch (e) {} };
    $('bImp').onclick = () => $('pickBackup').click();
    $('sUpd').onclick = checkUpdate;
  }
  $('pickBackup').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { st.importJSON(await f.text()); toast('Backup restored.'); applyPalette(); greet(); tasksChanged(); close(); } catch (er) { toast(er.message); } };
  $('settings').onclick = () => { setNav('homeNav'); showSettings(); };
  $('aboutNav').onclick = () => { setNav('aboutNav'); open('Hello, I’m E.V.', `<p>Your friendly neighbourhood assistant, living on this iPhone. Separate from laptop E.V., same attitude.</p>
    <div class="card"><small>I can</small><p>Talk (tap the mask), keep your missions and remind you, remember things about you, search the web and the news, do deep research, make presentations, mind maps and PDFs, read pages and identify things with the camera, look at screenshots, track expenses, record lectures, prayer times, timers, Hero mode, play Spotify, and get WhatsApp messages, texts, calls, e-mails and maps ready for you.</p></div>
    <div class="card"><small>iPhone won't let me</small><p>Send WhatsApp messages without your tap, control other apps or settings, see your screen live, listen for “Hey E.V.” or remind you while I'm closed.</p></div>
    <p>Brain: Google Gemini with your own key. Voice: ${esc(V.voiceName())}. Everything stays on this phone.</p>`, 'about'); };

  /* symbiote palette: circular wipe from the switch */
  function symbiote(input) {
    const on = input.checked, r = input.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const apply = () => { st.data.settings.palette = on; st.save(); applyPalette(); };
    if (!document.startViewTransition || RM()) return apply();
    const t = document.startViewTransition(apply);
    t.ready.then(() => { const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] }, { duration: 620, easing: ease, pseudoElement: '::view-transition-new(root)' }); });
  }

  /* ---------- first-run setup ---------- */
  function showSetup(changeKey) {
    const s = $('setup'); s.hidden = false;
    $('suName').value = st.data.settings.name || ''; $('suKey').value = ''; $('suErr').textContent = '';
    $('suTitle').innerHTML = changeKey ? 'New <span>key.</span>' : 'Suit <span>up.</span>';
    $('suGo').onclick = async () => {
      const key = $('suKey').value.trim(), name = $('suName').value.trim();
      if (key.length < 20) { $('suErr').textContent = 'That does not look like a Gemini key. It usually starts with “AIza”.'; return; }
      $('suGo').disabled = true; $('suGo').textContent = 'Checking the key…'; $('suErr').textContent = '';
      try { st.key.set(key); await G.validate(key); }
      catch (e) { st.key.set(''); $('suErr').textContent = e.message; $('suGo').disabled = false; $('suGo').textContent = 'Check key and start'; return; }
      if (name) st.data.settings.name = name;
      st.data.settings.setupDone = true; st.save(); greet();
      s.hidden = true; $('suGo').disabled = false; $('suGo').textContent = 'Check key and start';
      if (!changeKey && $('suPin').value.trim()) await importFromLaptop($('suPin').value.trim());
      if (!changeKey && st.data.profile && !st.data.welcomeSeen) { showWelcome(); return; }
      V.unlock(); say(changeKey ? 'New key works. Back in business.' : `Hey${st.data.settings.name ? ' ' + st.data.settings.name.split(' ')[0] : ''}. I'm E.V., now living on your phone. Tap the mask whenever you need me. No pressure, I'll just be here. Waiting.`);
    };
    $('suSkip').hidden = !changeKey; $('suSkip').onclick = () => { s.hidden = true; };
    $('suPinRow').hidden = !!changeKey;
  }
  function readGift(code) {                         // "EVGIFT1:" + base64 of the welcome pack
    const raw = code.replace(/^\s*EVGIFT1:/i, '').replace(/[^A-Za-z0-9+/=]/g, '');
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function importFromLaptop(code) {
    code = (code || prompt('Gift code, or the 6-digit code from laptop E.V.:') || '').trim();
    const gift = /^EVGIFT1:/i.test(code);
    if (!gift) { code = code.replace(/\D/g, ''); if (code.length !== 6) { if (code) toast('That is not a gift code or a 6-digit code.'); return; } }
    try {
      let j;
      if (gift) { try { j = readGift(code); } catch (e) { throw new Error('the gift code is incomplete. Copy the whole code and try again'); } }
      else {
        const r = await fetch('/api/handoff?pin=' + code, { cache: 'no-store' });
        j = await r.json(); if (!r.ok) throw new Error(j.error || 'The laptop said no.');
      }
      if (j.profile) {                               // a personal welcome pack prepared on the laptop
        st.data.profile = j.profile; st.data.settings.name = j.profile.name || j.name || '';
        (j.profile.memories || []).forEach(t => { if (!st.data.memory.some(m => m.text === t)) st.data.memory.push({ id: st.uid(), text: t, t: Date.now() }); });
        st.data.welcomeSeen = false;
      } else if (j.name && !st.data.settings.name) st.data.settings.name = j.name;
      (j.contacts || []).forEach(c => { if (!st.data.contacts.some(x => x.name.toLowerCase() === c.name.toLowerCase())) st.data.contacts.push(c); });
      if (j.spotify && j.spotify.refresh_token) st.data.spotify = j.spotify;
      st.save(); greet();
      if (!j.profile) toast(`Copied${j.name ? ' your name,' : ''} ${(j.contacts || []).length} contacts${j.spotify ? ' and Spotify' : ''} from the laptop.`);
      if (sheetName === 'settings') showSettings();
    } catch (e) { toast(gift ? "Couldn't read the code: " + e.message + '.' : "Couldn't reach the laptop. It must be on, with E.V. running, on the same Wi-Fi. (" + e.message + ')'); }
  }

  /* ---------- welcome screen for a personal welcome pack ---------- */
  function showWelcome() {
    const p = st.data.profile || {}, w = $('welcome'); if (!w) return;
    $('wTitle').textContent = p.welcome_title || ('Hey ' + (p.name || '') + '.');
    $('wText').textContent = p.welcome_text || '';
    w.hidden = false;
    anim(w, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
    $('wGo').onclick = () => {
      st.data.welcomeSeen = true; st.save(); V.unlock(); try { EV.live.unlock(); } catch (e) {}
      const a = anim(w, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in' });
      const done = () => { w.hidden = true; greet(); idleBrief(); shockwave('#ff3553'); if (useLive() && micOn()) startLive(); else say(p.greeting || 'Hey.'); };
      a ? a.onfinish = done : done();
    };
  }

  /* ---------- updates (only when the laptop is reachable) ---------- */
  async function checkUpdate() {
    const s = $('uState'); if (s) s.textContent = 'Checking…';
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) throw new Error('offline copy not set up');
      await reg.update(); if (s) s.textContent = reg.installing || reg.waiting ? 'Update downloaded. Close and reopen E.V.' : 'You have the latest version (' + EV.VERSION + ')'; }
    catch (e) { if (s) s.textContent = 'Laptop not reachable. Updates come from the laptop when it is on.'; }
  }

  /* ================= reminders, nagging, auto-sleep ================= */
  setInterval(() => {
    const now = Date.now(), s = st.data.settings;
    if (isOff()) return;
    for (const t of st.data.tasks) {
      if (t.done || !t.due) continue;
      const due = new Date(t.due).getTime();
      if (!t.fired && due <= now && now - due < 6 * 3600e3) {
        t.fired = true; t.nagged = now; st.save(); tasksChanged();
        announce('Reminder: ' + t.text + '.'); try { navigator.vibrate?.([300, 120, 300]); } catch (e) {}
        notify('E.V. reminder', t.text);
      } else if (t.fired && now - (t.nagged || 0) > s.remindEvery * 6e4 && due < now) {
        t.nagged = now; st.save(); announce(['Still waiting on ' + t.text + '.', t.text + ' is still open. Just saying.', 'About ' + t.text + '… any progress?'][Math.floor(Math.random() * 3)]);
      }
    }
    for (const tm of [...timers]) if (tm.end <= now) { timers.splice(timers.indexOf(tm), 1); announce(tm.label + ' is up.'); try { navigator.vibrate?.([400, 150, 400]); } catch (e) {} notify('E.V. timer', tm.label + ' is up.'); }
    if (s.autoSleep && senseState === 'idle' && !busy && !rec && !lec && !focusEnd && now - lastAct > s.autoSleep * 6e4 && $('overlay').hidden) setSense('sleeping');
  }, 15000);
  function notify(title, body) {
    try { if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'ev' })); } catch (e) {}
  }

  /* ================= Gemini Live: the laptop's voice, streamed like a call ================= */
  const useLive = () => (st.data.settings.voiceEngine || 'live') === 'live';
  let liveOn = false, liveOffers = [], heardTimer = null;
  function liveHooks() {
    return {
      onReady() { liveOn = true; setSense('listening'); brief("Go on, I'm listening…", { user: true }); offers([]); liveOffers = []; },
      onHeard(t) {
        touch(); if (EV.live.speaking) return;
        setSense('listening'); brief('“' + t + '”', { user: true });
        clearTimeout(heardTimer);
        heardTimer = setTimeout(() => { if (liveOn && senseState === 'listening' && !EV.live.speaking) { setSense('thinking'); $('senseHint').textContent = 'Thinking…'; } }, 650);
      },
      onSay(t) { brief(t, { label: 'E.V.' }); },
      onSpeaking(on) { clearTimeout(heardTimer); if (on) setSense('speaking'); else if (liveOn) { setSense('listening'); $('senseHint').textContent = 'Listening… tap to end'; } touch(); },
      onTool(n) { setSense('thinking'); $('senseHint').textContent = toolLabel(n); },
      onOffer(o) { liveOffers.push(o); offers(liveOffers); },
      onTurn() {
        const o = liveOffers; liveOffers = [];
        if (o.length === 1 && o[0].url && /^(https:\/\/wa\.me|sms:|tel:|mailto:|https:\/\/maps\.apple)/.test(o[0].url)) setTimeout(() => { try { location.href = o[0].url; } catch (e) {} }, 600);
      },
      onLevel: level,
      onClosed(reason) {
        liveOn = false; clearTimeout(heardTimer);
        if (senseState !== 'sleeping') { setSense('idle'); if (reason === 'quiet' || reason === 'tap') idleBrief(); }
      }
    };
  }
  let greetedThisLaunch = false;
  async function startLive(typed) {
    V.stop(); touch(); offers([]);
    setSense('thinking'); $('senseHint').textContent = 'Connecting…';
    try {
      await EV.live.start(liveHooks(), { mic: micOn() && !typed });
      const pf = st.data.profile;
      if (pf && pf.greeting && !greetedThisLaunch && !typed) {     // the startup line, every time E.V. starts
        greetedThisLaunch = true; EV.live.sendNote('E.V. just started. Greet her now with exactly: "' + pf.greeting + '" Then listen.');
      }
      if (typed) { EV.live.sendText(typed); brief('“' + typed + '”', { user: true }); setSense('thinking'); $('senseHint').textContent = 'Thinking…'; }
    } catch (e) {
      liveOn = false; EV.log('live unavailable, using the backup: ' + e.message);
      if (e.name === 'NotAllowedError') { setSense('idle'); brief('I need the microphone. Allow it in Settings → E.V. (or tap the mask again and press Allow).'); return; }
      toast("The live voice isn't available right now, so I'm using the backup voice.");
      setSense('idle');
      if (typed) ask(typed); else startListening();
    }
  }

  /* ================= power: E.V. off / on ================= */
  const isOff = () => !!st.data.settings.off;
  function powerOff() {
    st.data.settings.off = true; st.save(); EV.log('switched off');
    if (liveOn) EV.live.close('off'); if (rec) rec.stop(true); V.stop(); camera.close(); convoFollow = false;
    setSense('sleeping'); $('offScreen').hidden = false;
    anim($('offScreen'), [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
  }
  function powerOn() {
    st.data.settings.off = false; st.save(); EV.log('switched on');
    const o = $('offScreen'), a = anim(o, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-in' });
    const done = () => { o.hidden = true; setSense('idle'); idleBrief(); shockwave('#3f8bff'); };
    a ? a.onfinish = done : done();
  }
  if ($('powerBtn')) $('powerBtn').onclick = () => { V.unlock(); powerOff(); };
  if ($('powerOn')) $('powerOn').onclick = () => { V.unlock(); try { EV.live.unlock(); } catch (e) {} powerOn(); };

  /* ================= wiring: mask, composer, cards ================= */
  $('talk').onclick = () => {
    V.unlock(); touch(); try { EV.live.unlock(); } catch (e) {}
    if (useLive() && st.key.get()) {
      if (liveOn) { if (EV.live.speaking) { EV.live.interrupt(); } else { EV.live.close('tap'); } return; }
      if (!micOn()) { toast("The mic is off. Type below, or tap the mic button at the top to switch it on."); $('message').focus(); return; }
      if (senseState !== 'thinking') return startLive();
    }
    if (senseState === 'listening') return stopListening();
    if (senseState === 'speaking') { V.stop(); convoFollow = false; setSense('idle'); return; }
    if (senseState === 'thinking') { askId++; busy = false; V.stop(); setSense('idle'); brief('Okay, cancelled.'); EV.log('cancelled by tap'); return; }
    if (!st.key.get()) return showSetup(false);
    startListening();
  };
  if ($('micToggle')) $('micToggle').onclick = () => {
    V.unlock(); st.data.settings.mic = !micOn(); st.save(); renderMic();
    if (!micOn()) { if (rec) rec.stop(true); convoFollow = false; if (liveOn) EV.live.close('mic off'); if (senseState === 'listening') setSense('idle'); }
    toast(micOn() ? "Mic on. I'm listening." : 'Mic off. E.V. will not listen until you switch it back on. You can still type.');
    if (micOn() && !isOff() && st.key.get() && senseState !== 'thinking') {          // mic on = listening straight away
      try { EV.live.unlock(); } catch (e) {}
      if (useLive()) { if (!liveOn) startLive(); } else startListening();
    }
    anim($('micToggle'), [{ transform: 'scale(.6)' }, { transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 380, easing: ease });
  };
  $('sleepToggle').onclick = () => { V.unlock(); touch(); if (senseState === 'sleeping') { setSense('idle'); idleBrief(); } else { if (rec) rec.stop(true); if (liveOn) EV.live.close('sleep'); V.stop(); setSense('sleeping'); } };
  $('composer').addEventListener('submit', e => {
    e.preventDefault(); const q = $('message').value.trim(); if (!q) return; $('message').value = ''; V.unlock();
    if (!st.key.get()) return showSetup(false);
    thwip();
    if (useLive()) { try { EV.live.unlock(); } catch (e) {} if (liveOn) { EV.live.sendText(q); brief('“' + q + '”', { user: true }); setSense('thinking'); return; } return startLive(q); }
    ask(q);
  });
  $('camAct').onclick = () => { setNav('homeNav'); showCamera(); };
  $('newsAct').onclick = () => ask('What are the top news stories right now?');
  $('spotAct').onclick = () => { setNav('homeNav'); showSpotify(); };
  $('filesAct').onclick = () => { setNav('homeNav'); showFiles(); };
  $('jobChip').onclick = () => showFiles();

  /* tap feedback: web-shot burst */
  function burst(host, x, y, size, color) {
    if (RM()) return;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'burst'); s.setAttribute('viewBox', '-50 -50 100 100');
    s.style.cssText = `left:${x}px;top:${y}px;--s:${size}px;--bc:${color}`;
    let g = ''; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + (i % 2) * .15, r1 = 14 + (i % 2) * 4, r2 = 40 + (i % 3) * 6; g += `<line x1="${Math.cos(a) * r1}" y1="${Math.sin(a) * r1}" x2="${Math.cos(a) * r2}" y2="${Math.sin(a) * r2}"/>`; }
    s.innerHTML = g + '<circle r="22"/><circle r="34" stroke-dasharray="3 5"/>'; host.appendChild(s);
    s.animate([{ transform: 'scale(.3) rotate(-10deg)', opacity: 1 }, { transform: 'scale(1) rotate(8deg)', opacity: 0 }], { duration: 520, easing: ease }).onfinish = () => s.remove();
  }
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return; touch();
    const r = b.getBoundingClientRect(), big = b.classList.contains('action') ? 150 : b.id === 'talk' ? 0 : 70;
    if (big) burst(b, e.clientX - r.left, e.clientY - r.top, big, b.id === 'focus' ? '#6ca8ff' : '#ff3553');
  }, { passive: true });
  function thwip() {
    if (RM()) return; const s = $('composer').querySelector('.send'), r = s.getBoundingClientRect(), p = phone.getBoundingClientRect();
    const line = document.createElement('span'); line.className = 'thwip';
    line.style.cssText = `left:${r.left - p.left + r.width / 2}px;top:${r.top - p.top + r.height / 2}px;width:140px;transform:rotate(-48deg)`;
    phone.appendChild(line);
    line.animate([{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: .45 }, { clipPath: 'inset(0 0 0 100%)', opacity: 0 }], { duration: 420, easing: 'ease-out' }).onfinish = () => line.remove();
  }

  /* online / offline */
  const net = () => { $('offline').hidden = navigator.onLine; };
  addEventListener('online', net); addEventListener('offline', net);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (rec) rec.stop(true); if (liveOn) EV.live.close('away'); V.stop(); if (senseState === 'listening') setSense('idle'); } else { touch(); clock(); } });

  /* ================= start ================= */
  EV.ui = { toast, openSheet: (n, d) => n === 'news' ? showNews(d) : n === 'expenses' ? showExpenses(d) : null, camera, job, announce,
            tasksChanged, filesChanged, spotifyChanged, hero, timer, lecture, applyPalette,
            sleep: () => { if (liveOn) setTimeout(() => EV.live.close('sleep'), 2500); V.stop(); setSense('sleeping'); }, killAll: () => { if (liveOn) EV.live.close('stop'); V.stop(); if (rec) rec.stop(true); timers.length = 0; focusEnd = null; jobs.forEach(j => j.cancelled = true); if (lec) lecture('stop'); camera.close(); } };
  applyPalette(); clock(); setInterval(clock, 15000); greet(); tasksChanged(); idleBrief(); setSense('idle'); net(); renderMic();
  if (isOff()) { setSense('sleeping'); $('offScreen').hidden = false; }
  if (st.data.profile && st.data.profile.greeting && !isOff()) {          // the startup line shows on every start
    if (!st.data.welcomeSeen && st.key.get()) showWelcome();
    else brief(st.data.profile.greeting, { label: 'E.V.' });
  }
  requestAnimationFrame(() => setNav('homeNav'));
  if (!st.key.get() || !st.data.settings.setupDone) showSetup(false);
  else {
    const away = Date.now() - (st.data.lastSeen || 0);
    if (st.data.lastSeen && away > 6 * 3600e3) { const open = st.data.tasks.filter(t => !t.done).length;
      brief(`Welcome back. ${open ? open + ' mission' + (open > 1 ? 's' : '') + ' waiting.' : 'No missions waiting.'}`, { label: 'E.V.' }); }
  }
  setInterval(() => { st.data.lastSeen = Date.now(); st.save(); }, 60000); st.data.lastSeen = Date.now(); st.save();
  // when the phone is near the laptop, hand the diagnostics log over (helps fix problems; nothing else is sent)
  const fromLaptop = location.port === '8766';
  const sendLog = () => !fromLaptop ? null : fetch('/api/phonelog', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log: EV.VERSION + ' · ' + navigator.userAgent + String.fromCharCode(10) + EV.logs().join(String.fromCharCode(10)) }) }).catch(() => {});
  setTimeout(sendLog, 8000); setInterval(sendLog, 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) sendLog(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(e => console.warn('sw', e));
})();
