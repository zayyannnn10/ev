/* Voice: E.V. speaks with the iPhone's own Ava (Enhanced) voice (fast), and listens through the
   microphone, noticing on its own when the user has stopped talking. */
(function () {
  const synth = window.speechSynthesis;
  const st = EV.store;
  let voices = [], current = null, queue = [], speakingFlag = false, onDone = null, unlocked = false, gen = 0;

  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; [300, 1200, 3000].forEach(t => setTimeout(loadVoices, t)); }

  function pickVoice() {
    if (!voices.length) loadVoices();
    const want = (st.data.settings.voice || 'Ava').toLowerCase();
    const en = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    const named = en.filter(v => v.name.toLowerCase().startsWith(want));
    const q = v => /premium/i.test(v.name) ? 2 : /enhanced/i.test(v.name) ? 3 : 1;   // Enhanced first: the user's pick
    return named.sort((a, b) => q(b) - q(a))[0]
      || en.find(v => /samantha/i.test(v.name)) || en.find(v => v.lang === 'en-US') || en[0] || null;
  }
  function voiceName() { const v = pickVoice(); return v ? v.name : 'the phone\'s default voice'; }

  /* iPhone only lets a page make sound after a tap: call this from every tap (cheap after the first) */
  const player = new Audio(); player.playsInline = true; player.preload = 'auto';
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  function unlock() {
    if (!unlocked && synth) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch (e) {} }
    if (!unlocked) { try { player.src = SILENT; player.play().catch(() => {}); } catch (e) {} }
    unlocked = true;
  }

  /* which voice: 'auto' (Ava, switching to Gemini if Ava stays silent), 'ava' or 'gemini' */
  let avaBroken = false, avaMisses = 0;
  const engine = () => st.data.settings.voiceEngine || 'live';
  function speakingWith() { return engine() === 'gemini' || engine() === 'live' || (engine() === 'auto' && (avaBroken || !synth)) ? 'gemini' : 'ava'; }

  function clean(text) {
    return String(text || '').replace(/[*_#`>|]/g, '').replace(/https?:\/\/\S+/g, 'the link')
      .replace(/\s+/g, ' ').trim();
  }
  function chunks(text) {     // long lines get cut off on iPhone; speak sentence by sentence
    const parts = clean(text).match(/[^.!?]+[.!?]*["')\]]*\s*/g) || [clean(text)];
    const out = []; let cur = '';
    for (const p of parts) { if ((cur + p).length > 220 && cur) { out.push(cur); cur = p; } else cur += p; }
    if (cur.trim()) out.push(cur);
    return out;
  }

  function speak(text, hooks = {}) {
    stop();
    if (!clean(text)) { hooks.onend && hooks.onend(); return Promise.resolve(); }
    return new Promise(resolve => {
      speakingFlag = true; const g = ++gen;
      let finished = false;
      onDone = () => { if (finished) return; finished = true; speakingFlag = false; clearTimeout(guard); hooks.onend && hooks.onend(); resolve(); };
      // whatever happens, never leave E.V. stuck "speaking"
      const guard = setTimeout(() => { EV.log('voice: gave up waiting for speech to end'); stop(); }, 15000 + clean(text).length * 120);
      hooks.onstart && hooks.onstart();
      if (speakingWith() === 'gemini') return cloud(text, g);
      queue = chunks(text);
      let started = false;
      const v = pickVoice();
      EV.log('voice: speaking with ' + (v ? v.name : 'default voice'));
      next(hooks, g, () => { started = true; avaMisses = 0; });
      setTimeout(() => {                               // Ava stayed silent: this time use the Gemini voice
        if (started || g !== gen || !speakingFlag) return;
        avaMisses++;
        EV.log('voice: Ava did not start (' + avaMisses + ' in a row), using the Gemini voice this time');
        if (engine() === 'auto' && avaMisses >= 3) { avaBroken = true; EV.log('voice: switching to the Gemini voice for this session'); }
        queue = []; if (synth) synth.cancel();
        cloud(text, g);
      }, engine() === 'ava' ? 15000 : 6000);           // Ava (Enhanced) can take a few seconds to warm up
    });
  }
  function next(hooks, g, onStarted) {
    if (!speakingFlag || g !== gen) return;      // a late event from an older line
    if (!queue.length) { const d = onDone; onDone = null; d && d(); return; }
    const u = new SpeechSynthesisUtterance(queue.shift());
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = Math.min(2, Math.max(0.6, st.data.settings.rate || 1.0));
    u.onstart = () => onStarted && onStarted();
    u.onboundary = () => hooks.onword && hooks.onword();
    u.onend = () => next(hooks, g, onStarted);
    u.onerror = e => { EV.log('voice: Ava error ' + (e.error || '')); next(hooks, g, onStarted); };
    current = u;                       // keep a reference (iPhone drops garbage-collected utterances)
    synth.speak(u);
    if (synth.paused) synth.resume();
  }
  /* the Gemini voice: works even when the iPhone voice is blocked (played as normal audio) */
  async function cloud(text, g) {
    const all = chunks(text), first = all[0] || clean(text), rest = all.slice(1).join(' ');
    const make = t => t ? EV.gemini.tts(clean(t)).then(toUrl).catch(e => { EV.log('voice: Gemini voice failed: ' + e.message); return null; }) : Promise.resolve(null);
    const p1 = make(first), p2 = make(rest);                       // both start now; the first plays as soon as it's ready
    const u1 = await p1;
    if (!u1 && synth && g === gen && speakingFlag) {                 // Gemini's voice is out for now: let Ava say it
      EV.log('voice: Gemini voice unavailable, Ava speaks instead');
      queue = chunks(text); return next({}, g, null);
    }
    const finish = () => { if (g === gen) { const d = onDone; onDone = null; d && d(); } };
    const play = url => new Promise(res => {
      if (!url || g !== gen || !speakingFlag) return res();
      player.onended = player.onerror = () => { URL.revokeObjectURL(url); res(); };
      player.src = url; player.playbackRate = Math.min(1.4, Math.max(0.7, st.data.settings.rate || 1.0));
      player.play().catch(e => { EV.log('voice: play blocked ' + e.message); res(); });
    });
    await play(u1);
    await play(await p2);
    finish();
  }
  function toUrl(a) {
    const rate = parseInt((a.mime.match(/rate=(\d+)/) || [])[1]) || 24000;
    const pcm = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0));
    const blob = /wav|mpeg|mp3|ogg/.test(a.mime) ? new Blob([pcm], { type: a.mime }) : new Blob([wavHeader(pcm.length, rate), pcm], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }
  function wavHeader(len, rate) {
    const v = new DataView(new ArrayBuffer(44)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len, true); return v.buffer;
  }
  function stop() {                     // also finishes whoever was waiting for the old speech
    queue = []; speakingFlag = false; gen++;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    try { if (!player.paused) player.pause(); } catch (e) {}
    if (onDone) { const d = onDone; onDone = null; d(); }
  }

  /* ---------- microphone ---------- */
  function wav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data');
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return buf;
  }
  function b64(buf) {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function downsample(chunks, from, to) {
    let len = 0; chunks.forEach(c => len += c.length);
    const all = new Float32Array(len); let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
    if (from === to) return all;
    const ratio = from / to, out = new Float32Array(Math.floor(all.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += all[j]; out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  /* Recorder: opts {vad:true, onLevel(0..1), onSpeech(), maxMs, chunkMs, onChunk(b64)} */
  class Recorder {
    constructor(opts = {}) { this.o = Object.assign({ vad: true, maxMs: 45000, silenceMs: 900, waitMs: 9000 }, opts); }
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC(); if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.rate = this.ctx.sampleRate;
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this.buf = []; this.t0 = performance.now(); this.lastVoice = 0; this.heard = false; this.floor = 0.008; this.n = 0;
      this.chunkStart = performance.now();
      return new Promise(resolve => {
        this.resolve = resolve;
        this.proc.onaudioprocess = e => {
          const d = new Float32Array(e.inputBuffer.getChannelData(0)); this.buf.push(d);
          let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
          const rms = Math.sqrt(s / (d.length / 4)), now = performance.now();
          this.n++; if (this.n < 6) this.floor = Math.max(0.004, (this.floor * (this.n - 1) + rms) / this.n);
          this.o.onLevel && this.o.onLevel(Math.min(1, rms * 9));
          const loud = rms > Math.max(0.018, this.floor * 2.8);
          if (loud) { this.lastVoice = now; if (!this.heard) { this.heard = true; this.o.onSpeech && this.o.onSpeech(); } }
          if (this.o.chunkMs && now - this.chunkStart > this.o.chunkMs) { this.flushChunk(); this.chunkStart = now; }
          if (this.o.vad) {
            if (this.heard && now - this.lastVoice > this.o.silenceMs) this.stop();
            else if (!this.heard && now - this.t0 > this.o.waitMs) this.stop();
          }
          if (now - this.t0 > this.o.maxMs) this.stop();
        };
        this.src.connect(this.proc); this.proc.connect(this.ctx.destination);
      });
    }
    flushChunk() {
      if (!this.buf.length) return;
      const pcm = downsample(this.buf, this.rate, 16000); this.buf = [];
      this.o.onChunk && this.o.onChunk(b64(wav(pcm, 16000)), pcm.length / 16000);
    }
    stop(cancel) {
      if (this.stopped) return; this.stopped = true;
      try { this.proc.disconnect(); this.src.disconnect(); } catch (e) {}
      try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}       // the mic indicator goes off
      try { this.ctx.close(); } catch (e) {}
      if (cancel) { this.resolve && this.resolve(null); return; }
      if (this.o.chunkMs) { this.flushChunk(); this.resolve && this.resolve({ chunked: true }); return; }
      if (!this.heard) { this.resolve && this.resolve(null); return; }
      const pcm = downsample(this.buf, this.rate, 16000);
      this.resolve && this.resolve({ b64: b64(wav(pcm, 16000)), seconds: pcm.length / 16000 });
    }
  }

  EV.voice = { speak, stop, unlock, voiceName, pickVoice, Recorder, get speaking() { return speakingFlag; },
               available: !!synth, b64, speakingWith, resetAva() { avaBroken = false; avaMisses = 0; } };
})();
