/* Gemini Live on the phone: the same realistic voice as laptop E.V. (Vindemiatrix, British), streamed
   both ways like a call: the microphone goes up as you talk, E.V.'s voice comes back while it is still
   thinking, so there is no separate "write it down" or "make the audio" step. Tools work as usual. */
(function () {
  const st = EV.store;
  const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';
  const VOICE = 'Vindemiatrix';
  const STYLE = 'Speak with a British accent (standard southern English, like a polished Londoner), crisp and articulate, ' +
                'at a normal, natural pace. Warm and composed.';
  const cool = {};
  let ws = null, ctx = null, mic = null, hooks = {}, ready = false, playHead = 0, sources = [], speakingNow = false,
      turnText = '', heardText = '', lastHeardAt = 0, lastVoiceAt = 0, idleTimer = null, model = '', turnOpen = false;

  /* fastest first (measured): native-audio previews, then the newer live models */
  function rank(n) {
    if (/native-audio-preview-12/.test(n)) return 0;
    if (/native-audio-preview-09/.test(n)) return 1;
    if (/native-audio-latest/.test(n)) return 2;
    if (/native-audio/.test(n)) return 3;
    if (/-live$|live-preview/.test(n)) return 4 + (/3\.1/.test(n) ? 1 : 0);
    return 9;
  }
  async function models() {
    const c = st.data.liveModels;
    if (c && Date.now() - c.t < 86400000) return c.list;
    const key = st.key.get();
    const j = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=300&key=' + encodeURIComponent(key))).json();
    const list = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'))
      .map(m => m.name).filter(n => !/transcribe|robotics|translate|extended-thinking/.test(n)).sort((a, b) => rank(a) - rank(b));
    st.data.liveModels = { t: Date.now(), list }; st.save();
    EV.log('live models: ' + list.map(n => n.replace('models/', '')).join(', '));
    return list;
  }

  /* must be called from a tap: iPhone only starts audio from a gesture */
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  }

  function setupMsg(m) {
    const gen = { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } };
    if (/native-audio/.test(m)) gen.thinkingConfig = { thinkingBudget: 0 };          // answer straight away
    return { setup: {
      model: m, generationConfig: gen,
      systemInstruction: { parts: [{ text: EV.prompt.build('\nVOICE STYLE\n- ' + STYLE) }] },
      // Gemini's own Google Search (fast, its own allowance) + E.V.'s tools (minus the slow web_search)
      tools: [{ googleSearch: {} }, { functionDeclarations: EV.tools.declarations().filter(d => d.name !== 'web_search') }],
      inputAudioTranscription: {}, outputAudioTranscription: {},
      // background sound must not cancel E.V.'s answer (tap the mask to interrupt instead); less jumpy about noise
      realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                                                         silenceDurationMs: 500, prefixPaddingMs: 200 }, activityHandling: 'NO_INTERRUPTION' }
    } };
  }

  function open(m) {
    return new Promise((resolve, reject) => {
      const s = new WebSocket(WS + encodeURIComponent(st.key.get()));
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; try { s.close(); } catch (e) {} reject(new Error('timed out')); } }, 9000);
      s.onopen = () => s.send(JSON.stringify(setupMsg(m)));
      s.onmessage = async ev => {
        const msg = await parse(ev.data); if (!msg) return;
        if (!done && msg.setupComplete) { done = true; clearTimeout(t); resolve(s); return; }
        if (done) onMessage(msg);
      };
      s.onclose = e => {
        if (!done) { done = true; clearTimeout(t); reject(new Error(e.reason || ('closed ' + e.code))); return; }
        if (s === ws) { EV.log('live: closed ' + e.code + ' ' + (e.reason || '').slice(0, 120)); end(); }
      };
      s.onerror = () => {};
    });
  }
  async function parse(d) {
    try { return JSON.parse(typeof d === 'string' ? d : await (d.text ? d.text() : new Response(d).text())); } catch (e) { return null; }
  }

  /* start a live conversation. opts: {mic: true}; hooks: onReady, onHeard(text), onSay(text), onSpeaking(bool),
     onTool(name), onOffer(offer), onTurn(heard, said), onLevel(v), onClosed(reason) */
  async function start(h, opts = {}) {
    hooks = h || {};
    if (ws) { if (opts.mic !== false && !mic) await startMic(); return true; }
    unlock();
    const list = (await models()).filter(m => !(cool[m] > Date.now()));
    let lastErr = null;
    for (const m of list.slice(0, 5)) {
      const t0 = Date.now();
      try {
        ws = await open(m); model = m; ready = true;
        EV.log(`live: connected ${m.replace('models/', '')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        // the conversation memory is in the system instruction; old turns are NOT replayed (they could re-run old commands)
        if (opts.mic !== false) await startMic();
        bumpIdle(); hooks.onReady && hooks.onReady();
        return true;
      } catch (e) {
        lastErr = e; ws = null;
        EV.log(`live: ${m.replace('models/', '')} failed: ${String(e.message).slice(0, 140)}`);
        cool[m] = Date.now() + (/quota|exceeded|limit|RESOURCE/i.test(e.message) ? 3600e3 : 120e3);
        if (e.name === 'NotAllowedError') throw e;
      }
    }
    throw lastErr || new Error('No live voice model available.');
  }

  function sendHistory() {                         // what you talked about recently, so it remembers
    const turns = EV.agent.history();
    if (turns.length) send({ clientContent: { turns, turnComplete: false } });
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  /* ---------- microphone up ---------- */
  /* The microphone gets its OWN audio engine, created after the mic is on: on iPhone, an engine made
     before the mic (like the one that plays E.V.'s voice) only ever hears silence. */
  let playUntil = 0, micStats = { chunks: 0, peak: 0, t: 0 };
  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const AC = window.AudioContext || window.webkitAudioContext;
    const mctx = new AC();
    if (mctx.state === 'suspended') await mctx.resume();
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});     // iPhone may pause the speaker engine when the mic starts
    const src = mctx.createMediaStreamSource(stream), proc = mctx.createScriptProcessor(4096, 1, 1), ratio = mctx.sampleRate / 16000;
    micStats = { chunks: 0, peak: 0, t: Date.now() };
    EV.log(`live: mic on (${mctx.sampleRate} Hz, ${stream.getAudioTracks()[0]?.label || 'mic'})`);
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      let s = 0; for (let i = 0; i < d.length; i += 8) s += d[i] * d[i];
      const lv = Math.min(1, Math.sqrt(s / (d.length / 8)) * 9);
      micStats.peak = Math.max(micStats.peak, lv);
      if (Date.now() - micStats.t > 5000) { EV.log(`live: mic level ${micStats.peak.toFixed(2)}, ${micStats.chunks} chunks sent`); micStats.t = Date.now(); micStats.peak = 0; }
      hooks.onLevel && hooks.onLevel(speakingNow ? 0 : lv);
      if (lv > 0.12) lastVoiceAt = Date.now();
      if (!ready || speakingNow || Date.now() < playUntil + 300) return;          // don't send E.V.'s own voice back
      const n = Math.floor(d.length / ratio), pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { a += d[j]; c++; }
        const v = Math.max(-1, Math.min(1, a / (c || 1))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      send({ realtimeInput: { audio: { data: EV.voice.b64(pcm.buffer), mimeType: 'audio/pcm;rate=16000' } } });
      micStats.chunks++;
    };
    src.connect(proc); proc.connect(mctx.destination);
    mic = { stream, src, proc, mctx };
    stream.getAudioTracks()[0]?.addEventListener('ended', () => EV.log('live: the iPhone stopped the mic'));
  }
  function stopMic() {
    if (!mic) return;
    try { mic.proc.disconnect(); mic.src.disconnect(); } catch (e) {}
    try { mic.stream.getTracks().forEach(t => t.stop()); } catch (e) {}          // the mic indicator goes off
    try { mic.mctx.close(); } catch (e) {}
    mic = null;
  }

  /* ---------- E.V.'s voice down ---------- */
  function play(b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), n = bytes.length >> 1, dv = new DataView(bytes.buffer);
    const buf = ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    let s = 0;
    for (let i = 0; i < n; i++) { const v = dv.getInt16(i * 2, true) / 32768; ch[i] = v; s += v * v; }
    hooks.onLevel && hooks.onLevel(Math.min(1, Math.sqrt(s / n) * 6));
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const at = Math.max(ctx.currentTime + 0.03, playHead); src.start(at); playHead = at + buf.duration;
    playUntil = Math.max(playUntil, Date.now()) + buf.duration * 1000;          // wall clock: never gets stuck
    sources.push(src);
    src.onended = () => { sources = sources.filter(x => x !== src); if (!sources.length && !turnOpen) quiet(); };
    clearTimeout(play.guard);
    play.guard = setTimeout(() => { if (speakingNow && !turnOpen) { EV.log('live: voice end not reported, listening again'); sources = []; quiet(); } }, (playUntil - Date.now()) + 1500);
    if (!speakingNow) { speakingNow = true; hooks.onSpeaking && hooks.onSpeaking(true); }
  }
  function quiet() { if (speakingNow) { speakingNow = false; hooks.onSpeaking && hooks.onSpeaking(false); } bumpIdle(); }
  function interrupt() {                             // tap the mask while E.V. talks
    sources.forEach(s => { try { s.stop(); } catch (e) {} }); sources = []; playHead = ctx ? ctx.currentTime : 0; playUntil = 0; turnOpen = false; quiet();
  }

  async function onMessage(m) {
    const sc = m.serverContent;
    if (sc) {
      if (sc.inputTranscription && sc.inputTranscription.text) { heardText += sc.inputTranscription.text; lastHeardAt = Date.now(); lastUserWords = heardText; hooks.onHeard && hooks.onHeard(heardText.trim()); bumpIdle(); }
      if (sc.modelTurn && sc.modelTurn.parts) { turnOpen = true; for (const p of sc.modelTurn.parts) if (p.inlineData && /audio/.test(p.inlineData.mimeType || '')) play(p.inlineData.data); }
      if (sc.outputTranscription && sc.outputTranscription.text) { turnText += sc.outputTranscription.text; hooks.onSay && hooks.onSay(turnText.trim()); }
      if (sc.interrupted) interrupt();
      if (sc.turnComplete || sc.generationComplete) {
        if (sc.turnComplete) {
          turnOpen = false;
          const heard = heardText.trim(), said = turnText.trim();
          if (heard) EV.agent.remember('user', heard);
          if (said) EV.agent.remember('ev', said);
          hooks.onTurn && hooks.onTurn(heard, said);
          heardText = ''; turnText = '';
          if (!sources.length) quiet();
        }
      }
    }
    if (m.toolCall && m.toolCall.functionCalls) {
      const responses = [];
      for (const c of m.toolCall.functionCalls) {
        hooks.onTool && hooks.onTool(c.name); EV.log('live tool: ' + c.name);
        const out = await EV.tools.run(c.name, c.args || {});
        if (out && out.needs_tap) hooks.onOffer && hooks.onOffer({ label: out.label || 'Open', url: out.open || '', action: out.action || '', question: out.question || '' });
        responses.push({ id: c.id, name: c.name, response: out && typeof out === 'object' ? out : { result: String(out) } });
      }
      send({ toolResponse: { functionResponses: responses } });
    }
    if (m.goAway) { EV.log('live: server asked to reconnect'); }
  }

  /* typed messages go into the same conversation */
  function sendNote(text) { send({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[System note, not from the user] ' + text }] }], turnComplete: true } }); bumpIdle(); }
  function sendText(text) { turnText = ''; lastUserWords = text; lastHeardAt = Date.now(); send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }); EV.agent.remember('user', text); bumpIdle(); }

  /* hang up after 25 quiet seconds, like the laptop going to sleep (saves the free allowance) */
  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (speakingNow || turnOpen || Date.now() - lastVoiceAt < 4000) return bumpIdle();
      EV.log('live: hung up after a quiet spell'); close('quiet');
    }, 25000);
  }
  function close(reason) {
    const s = ws; ws = null; ready = false;
    try { s && s.close(); } catch (e) {}
    end(reason);
  }
  function end(reason) {
    // keep whatever was said in the moment the call ended (switching apps, mic off…)
    if (heardText.trim()) EV.agent.remember('user', heardText.trim());
    if (turnText.trim()) EV.agent.remember('ev', turnText.trim() + (turnOpen ? ' …' : ''));
    heardText = ''; turnText = '';
    clearTimeout(idleTimer); stopMic(); ws = null; ready = false; turnOpen = false;
    if (speakingNow) { speakingNow = false; hooks.onSpeaking && hooks.onSpeaking(false); }
    const h = hooks; hooks = {}; h.onClosed && h.onClosed(reason || 'closed');
  }

  let lastUserWords = '';
  EV.live = { start, close, interrupt, sendText, sendNote, unlock, get lastUserWords() { return Date.now() - lastHeardAt < 60000 ? lastUserWords : ''; }, get open() { return !!ws; }, get speaking() { return speakingNow; },
              get model() { return model.replace('models/', ''); }, get micOn() { return !!mic; } };
})();
