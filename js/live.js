/* Gemini Live on the phone: the same realistic voice as laptop E.V. (Vindemiatrix, British), streamed
   both ways like a call: the microphone goes up as you talk, E.V.'s voice comes back while it is still
   thinking, so there is no separate "write it down" or "make the audio" step. Tools work as usual. */
(function () {
  const st = EV.store;
  const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';
  const VOICE = 'Vindemiatrix';
  const STYLE = 'Speak with a British accent (standard southern English, like a polished Londoner), crisp and articulate, ' +
                'at a normal, natural pace. Warm and composed.';
  const CONVO = `
VOICE CONVERSATION (sound like a real person on a call)
- React first, the way people do ("Oh nice!", "Hmm, fair.", "Wait, really?"), then answer. Vary it; never start every reply the same way.
- Match the moment: a quick question gets one or two sentences; a story or a feeling gets a slower, warmer answer; match their energy.
- Natural spoken language: contractions, short sentences, the odd "honestly" or "okay so", a light laugh where it fits. Never read out lists or headings.
- Really listen: refer back to what they said earlier, and ask one natural question back when it fits (not after every reply).
- If they interrupt you, stop gracefully and respond to what they just said ("Oh, sorry, go on" or pick up their new point). Don't restart your old answer unless they ask.
- PAUSING: when they say "wait", "hey E.V., wait", "hold on", "hang on", "one sec", "stop", "pause" or "shh" (alone or with your name), you have been paused. Drop what you were saying and answer in a few words only, then stay quiet and let them talk, for example "Yeah? What is it?", "Sure, I'm listening.", "Mm-hm, go ahead.", "Oh, you paused me. What's up?" (vary it). Do not continue, summarise or mention the old answer and do not use any long greeting here (this beats the greeting rules). Whatever they say next is a fresh conversation. Only go back to the old answer if they ask ("carry on", "continue", "go on", "where were we"); then resume from the point you stopped.
- Use their name now and then, not every time.
- LECTURES AND LONG TALKS: when asked for a lecture, lesson, story or explanation of a given length (for example "a 5 minute lecture"), talk continuously like an engaging teacher: a hook, three or four parts with examples and a recap at the very end, about 150 words per minute. Never stop to ask questions in the middle. When you are told to continue, carry on exactly where you stopped (finish the sentence you were in), with no greeting and no recap.`;
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
      systemInstruction: { parts: [{ text: EV.prompt.build('\nVOICE STYLE\n- ' + STYLE + '\n' + CONVO) }] },
      // Gemini's own Google Search (fast, its own allowance) + E.V.'s tools (minus the slow web_search)
      tools: [{ googleSearch: {} }, { functionDeclarations: EV.tools.declarations().filter(d => d.name !== 'web_search') }],
      inputAudioTranscription: {}, outputAudioTranscription: {},
      // the user can interrupt by talking; the phone only lets real speech through while E.V. talks (see the mic below)
      realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                                                         silenceDurationMs: 500, prefixPaddingMs: 200 } },
      contextWindowCompression: { slidingWindow: {} }          // long conversations and lectures don't run out of room
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
      if (!ready) return;
      const n = Math.floor(d.length / ratio), pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { a += d[j]; c++; }
        const v = Math.max(-1, Math.min(1, a / (c || 1))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      const busy = (speakingNow || toolBusy > 0 || Date.now() < playUntil + 300) && Date.now() > bargeUntil;
      if (!busy) { while (recent.length) sendChunk(recent.shift()); sendChunk(pcm); return; }
      // E.V. is talking or working: E.V.'s own voice and background noise stay out, but the user's voice
      // (clearly louder than the echo, for about a quarter of a second) stops E.V. and goes through
      recent.push(pcm); if (recent.length > 12) recent.shift();          // last second, so the start of your words is kept
      if (lv > Math.max(0.35, echoBase * 2.4)) loudFrames++;
      else { loudFrames = Math.max(0, loudFrames - 1); echoBase = echoBase * 0.9 + lv * 0.1; }   // short dips between words don't reset it
      if (loudFrames >= 4) {
        loudFrames = 0; EV.log('live: you interrupted E.V.');
        bargeUntil = Date.now() + 4000; dropAudio = true; pauseLecture();
        interrupt(); hooks.onInterrupted && hooks.onInterrupted();
        while (recent.length) sendChunk(recent.shift());          // the start of what you said is not lost
      }
    };
    src.connect(proc); proc.connect(mctx.destination);
    mic = { stream, src, proc, mctx };
    stream.getAudioTracks()[0]?.addEventListener('ended', () => EV.log('live: the iPhone stopped the mic'));
  }
  let recent = [], loudFrames = 0, echoBase = 0.05, bargeUntil = 0, toolBusy = 0, dropAudio = false;
  function sendChunk(pcm) { send({ realtimeInput: { audio: { data: EV.voice.b64(pcm.buffer), mimeType: 'audio/pcm;rate=16000' } } }); micStats.chunks++; }
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
    turnAudio += buf.duration;
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
      if (sc.inputTranscription && sc.inputTranscription.text) { heardText += sc.inputTranscription.text; sincePause = (sincePause + sc.inputTranscription.text).slice(-200); lastHeardAt = Date.now(); lastUserWords = heardText; hooks.onHeard && hooks.onHeard(heardText.trim()); bumpIdle(); }
      if (sc.modelTurn && sc.modelTurn.parts && !dropAudio) { turnOpen = true; for (const p of sc.modelTurn.parts) if (p.inlineData && /audio/.test(p.inlineData.mimeType || '')) play(p.inlineData.data); }
      if (sc.outputTranscription && sc.outputTranscription.text) { turnText += sc.outputTranscription.text; hooks.onSay && hooks.onSay(turnText.trim()); }
      if (sc.interrupted) { interrupt(); dropAudio = false; pauseLecture(); }
      if (sc.turnComplete || sc.generationComplete) {
        if (sc.turnComplete) {
          turnOpen = false;
          const heard = heardText.trim(), said = turnText.trim();
          if (heard) EV.agent.remember('user', heard);
          if (said) EV.agent.remember('ev', said);
          hooks.onTurn && hooks.onTurn(heard, said);
          const wasDropped = dropAudio; dropAudio = false;
          lectureStep(heard || lastTyped, wasDropped || cut); cut = false;
          heardText = ''; turnText = ''; lastTyped = ''; turnAudio = 0;
          if (!sources.length) quiet();
        }
      }
    }
    if (m.toolCall && m.toolCall.functionCalls) {
      const responses = [];
      for (const c of m.toolCall.functionCalls) {
        hooks.onTool && hooks.onTool(c.name); EV.log('live tool: ' + c.name);
        toolBusy++;
        let out; try { out = await EV.tools.run(c.name, c.args || {}); } finally { toolBusy--; }
        if (out && out.needs_tap) hooks.onOffer && hooks.onOffer({ label: out.label || 'Open', url: out.open || '', action: out.action || '', question: out.question || '', args: out.args || null });
        responses.push({ id: c.id, name: c.name, response: out && typeof out === 'object' ? out : { result: String(out) } });
      }
      send({ toolResponse: { functionResponses: responses } });
    }
    if (m.goAway) { EV.log('live: server asked to reconnect'); }
  }

  /* typed messages go into the same conversation */
  function sendNote(text) { send({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[System note, not from the user] ' + text }] }], turnComplete: true } }); bumpIdle(); }
  /* long lectures: one live answer stops after about 2 minutes, so E.V. is told to carry on until the time is up */
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, half: 0.5 };
  let lecture = null, paused = null, cut = false, sincePause = '', turnAudio = 0, lastTyped = '';
  const RESUME = /\b(carry on|continue|go on|keep going|resume|where were we)\b/i;
  function lectureTarget(t) {
    t = String(t || '').toLowerCase();
    if (!/lecture|lesson|talk|speech|story|explain|teach|podcast|presentation|tell me (all )?about|overview/.test(t)) return 0;
    const m = t.match(/(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|half)[\s-]*(?:an?\s*)?(minute|min|hour)s?\b/);
    if (!m) return 0;
    const n = parseFloat(m[1]) || NUM[m[1]] || 1;
    return Math.min(20 * 60, Math.max(60, n * (m[2] === 'hour' ? 3600 : 60)));
  }
  function pauseLecture() {                     // "wait" in the middle of a lecture: it can be picked up again with "carry on"
    if (!lecture) { const want = lectureTarget(heardText || lastTyped); if (want) lecture = { target: want, spoken: 0, parts: 0 }; }   // paused in its first part
    if (lecture) { lecture.spoken += turnAudio; lecture.at = Date.now(); paused = lecture; sincePause = ''; }
    lecture = null; cut = true;
  }
  function lectureStep(request, interrupted) {
    if (interrupted) { lecture = null; return; }            // paused: pauseLecture() kept it for "carry on"
    const want = lectureTarget(request);
    if (want) { lecture = { target: want, spoken: turnAudio, parts: 1 }; paused = null; EV.log(`live: lecture of ${Math.round(want / 60)} min started`); }
    else if (!lecture && paused && Date.now() - paused.at < 600e3 && !interrupted && RESUME.test((request || '') + ' ' + sincePause)) { lecture = paused; paused = null; lecture.spoken += turnAudio; lecture.parts++; EV.log('live: lecture resumed'); }
    else if (lecture && !interrupted) { lecture.spoken += turnAudio; lecture.parts++; }
    else { lecture = null; return; }
    if (interrupted || !lecture) { lecture = null; return; }
    const left = lecture.target - lecture.spoken;
    // stop once the time is up or the closing part has been said
    if (left < 25 || lecture.final || lecture.parts > 12) { EV.log(`live: lecture done, ${Math.round(lecture.spoken)}s spoken`); lecture = null; return; }
    const mins = Math.max(0.5, Math.round(left / 30) / 2);
    lecture.final = left < 75;
    sendNote(`Continue exactly where you stopped (finish the sentence you were in the middle of). No greeting, no recap of what you already said, no questions. About ${mins} minute${mins === 1 ? '' : 's'} of the lecture remain${lecture.final ? '; this is the last part, so wrap up with a short recap at the end' : ''}.`);
  }

  function sendText(text, note) {                 // note: an instruction sent with this message (not saved as her words)
    lastTyped = text; turnText = ''; lastUserWords = text; lastHeardAt = Date.now();
    const parts = note ? [{ text: '[System note, not from the user] ' + note }, { text }] : [{ text }];
    send({ clientContent: { turns: [{ role: 'user', parts }], turnComplete: true } }); EV.agent.remember('user', text); bumpIdle();
  }

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
