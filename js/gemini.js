/* Gemini, called straight from the phone with the phone's own key.
   Models are discovered once a day and rotated like on the laptop: when one hits its free limit it
   cools down and the next one answers, so E.V. keeps going. */
(function () {
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const st = EV.store;
  const cool = {};                         // model -> time it may be used again

  class KeyError extends Error {}
  class LimitError extends Error {}

  function ver(name) { const m = name.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; }

  async function discover(key, force) {
    const cached = st.data.models;
    if (!force && cached && cached.key === key.slice(-6) && Date.now() - cached.t < 86400000) return cached;
    const r = await fetch(`${API}/models?pageSize=200&key=${encodeURIComponent(key)}`);
    if (r.status === 400 || r.status === 403) throw new KeyError('The Gemini key was refused. Check it and paste it again.');
    if (!r.ok) throw new Error('Gemini is not reachable right now (' + r.status + ').');
    const j = await r.json();
    const names = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', ''))
      .filter(n => /^gemini-/.test(n) && !/tts|image|live|audio|embedding|vision|robotics|computer|exp-\d|thinking/.test(n));
    const flash = names.filter(n => /flash/.test(n) && !/lite/.test(n)).sort((a, b) => ver(b) - ver(a) || a.length - b.length);
    const lite = names.filter(n => /flash-lite/.test(n)).sort((a, b) => ver(b) - ver(a) || a.length - b.length);
    const pool = [...flash, ...lite];
    if (!pool.length) pool.push('gemini-2.5-flash', 'gemini-2.5-flash-lite');
    const tts = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', '')).filter(n => /tts/.test(n) && !/pro/.test(n)).sort((a, b) => ver(b) - ver(a));
    const res = { key: key.slice(-6), t: Date.now(), smart: pool, fast: [...lite, ...flash], tts };
    EV.log('models: ' + pool.slice(0, 3).join(', ') + (tts.length ? ' · voice ' + tts[0] : ''));
    st.data.models = res; st.save();
    return res;
  }

  async function call(model, body, key, timeoutMs = 60000) {
    const ctl = new AbortController(), t0 = Date.now();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);        // never wait forever on a bad connection
    let r;
    try {
      r = await fetch(`${API}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      EV.log(`${model}: no answer (${e.name === 'AbortError' ? 'timed out after ' + timeoutMs / 1000 + 's' : e.message})`);
      const err = new Error(e.name === 'AbortError' ? 'Gemini took too long to answer.' : "Couldn't reach Gemini: " + e.message); err.status = 504; throw err;
    } finally { clearTimeout(timer); }
    EV.log(`${model}: ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (r.ok) return r.json();
    let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch (e) {}
    EV.log('  ' + msg.slice(0, 160));
    if (r.status === 400 && /api key/i.test(msg)) throw new KeyError('The Gemini key was refused.');
    if (r.status === 403) throw new KeyError('This Gemini key is not allowed to use ' + model + '.');
    if (r.status === 429) throw new LimitError(msg || 'limit');
    const e = new Error(msg || ('Gemini error ' + r.status)); e.status = r.status; throw e;
  }

  /* opts: {contents, system, tools, json, schema, speed:'smart'|'fast', toolConfig, temperature} */
  async function generate(opts) {
    const key = st.key.get();
    if (!key) throw new KeyError('No Gemini key yet.');
    if (!navigator.onLine) throw new Error("You're offline. I need the internet to think.");
    const models = await discover(key);
    const tag = (opts.tools || []).some(t => t.google_search) ? '#search' : '';      // Google Search has its own limit
    const usable = m => !(cool[m] > Date.now()) && !(tag && cool[m + tag] > Date.now());
    // models that answered well in the last half hour go first, fastest first; the rest keep their order
    const stats = st.data.modelStats || (st.data.modelStats = {});
    const recent = m => stats[m] && Date.now() - stats[m].t < 1800e3;
    const base = (opts.speed === 'fast' ? models.fast : models.smart).filter(usable);
    const order = [...base.filter(recent).sort((a, b) => stats[a].ms - stats[b].ms), ...base.filter(m => !recent(m))];
    if (!order.length) throw new LimitError("Every Gemini model is busy or at its free limit right now. Give it a minute.");
    const body = { contents: opts.contents };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (opts.tools) body.tools = opts.tools;
    if (opts.toolConfig) body.toolConfig = opts.toolConfig;
    const gc = {};
    if (opts.json) { gc.responseMimeType = 'application/json'; if (opts.schema) gc.responseSchema = opts.schema; }
    if (opts.temperature != null) gc.temperature = opts.temperature;
    if (Object.keys(gc).length) body.generationConfig = gc;
    let last;
    for (const m of order.slice(0, 6)) {
      const t0 = Date.now();
      try {
        // a model gets 20 s (longer for big writing jobs) before E.V. moves on to the next one
        const j = await call(m, body, key, opts.timeout || (opts.json ? 45000 : 20000));
        j._model = m;
        stats[m] = { t: Date.now(), ms: Date.now() - t0 }; st.save();
        return j;
      } catch (e) {
        if (e instanceof KeyError) throw e;
        last = e; delete stats[m];
        const wait = e instanceof LimitError ? (/day|daily|PerDay/i.test(e.message) ? 3600e3 : 60e3)
          : e.status === 404 ? 86400e3 : e.status === 503 ? 120e3 : e.status === 504 ? 300e3 : 30e3;   // busy: 2 min, hanging: 5 min
        cool[e.status === 404 || e.status === 503 || e.status === 504 ? m : m + tag] = Date.now() + wait;
      }
    }
    throw last instanceof LimitError ? new LimitError("I've hit Gemini's free limit for the moment. Try again in a minute.")
      : last && (last.status === 503 || last.status === 504) ? new Error("Google's Gemini is overloaded right now. Try again in a minute.") : last;
  }

  function text(j) {
    const parts = j?.candidates?.[0]?.content?.parts || [];
    return parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  }
  function parseJSON(s) {
    s = (s || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
      throw e;
    }
  }
  async function ask(prompt, o = {}) {
    const parts = [{ text: prompt }, ...(o.parts || [])];
    const j = await generate({ contents: [{ role: 'user', parts }], system: o.system, json: o.json,
                               schema: o.schema, speed: o.speed, temperature: o.temperature });
    const t = text(j);
    return o.json ? parseJSON(t) : t;
  }

  /* what the user said (WAV, base64) -> text */
  async function transcribe(b64) {
    const j = await generate({ speed: 'fast', temperature: 0, contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'audio/wav', data: b64 } },
      { text: 'Transcribe exactly what the speaker says, in the language they speak, with normal punctuation. ' +
              'Output only the words. If there is no clear speech, output nothing.' }] }] });
    return text(j).replace(/^["“]|["”]$/g, '').trim();
  }

  /* current facts from Google Search (grounding); when that allowance is used up, Wikipedia + what the
     model knows, clearly marked as possibly out of date */
  async function search(query, instruction) {
    const q = (instruction || 'Answer using up-to-date information from Google Search. Be specific and concise.') + '\n\nQuestion: ' + query;
    try {
      const j = await generate({ tools: [{ google_search: {} }], contents: [{ role: 'user', parts: [{ text: q }] }] });
      const meta = j?.candidates?.[0]?.groundingMetadata || {};
      const sources = (meta.groundingChunks || []).map(c => c.web).filter(Boolean)
        .map(w => ({ title: w.title || '', url: w.uri || '' })).slice(0, 8);
      return { text: text(j), sources, live: true };
    } catch (e) {
      if (e instanceof KeyError) throw e;
      const wiki = await wikipedia(query);
      const t = await ask(q + "\n\nGoogle Search is not available right now. Use these Wikipedia extracts if relevant, and your own " +
        "knowledge. If the question needs live data (scores, prices, today's news), say plainly that you could not check live sources.\n\n" +
        wiki.map(w => w.title + ': ' + w.extract).join('\n\n'));
      return { text: t, sources: wiki.map(w => ({ title: 'Wikipedia: ' + w.title, url: w.url })), live: false };
    }
  }
  async function wikipedia(q) {
    try {
      const s = await (await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: '3', format: 'json', origin: '*' }))).json();
      const titles = (s.query?.search || []).map(x => x.title);
      if (!titles.length) return [];
      const e = await (await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', titles: titles.join('|'), format: 'json', origin: '*' }))).json();
      return Object.values(e.query?.pages || {}).map(p => ({ title: p.title, extract: (p.extract || '').slice(0, 1500), url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title) }));
    } catch (e) { return []; }
  }

  /* backup voice when the iPhone's own voice is blocked: Gemini speech (24 kHz PCM, base64) */
  async function tts(textIn) {
    const key = st.key.get(), models = await discover(key);
    const list = (models.tts && models.tts.length ? models.tts : ['gemini-2.5-flash-preview-tts']).filter(m => !(cool[m] > Date.now()));
    const body = { contents: [{ role: 'user', parts: [{ text: textIn }] }],          // only the words: an instruction here was sometimes read out loud
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Vindemiatrix' } } } } };
    let last;
    for (const m of list) {
      try {
        const j = await call(m, body, key, 45000);
        const p = (j.candidates?.[0]?.content?.parts || []).find(x => x.inlineData);
        if (p) return { b64: p.inlineData.data, mime: p.inlineData.mimeType || 'audio/L16;rate=24000' };
      } catch (e) { last = e; if (e instanceof KeyError) throw e; cool[m] = Date.now() + (e instanceof LimitError ? 3600e3 : 30e3); }
    }
    throw last || new Error('No Gemini voice available.');
  }

  async function vision(prompt, jpegB64, mime) {
    return ask(prompt, { parts: [{ inlineData: { mimeType: mime || 'image/jpeg', data: jpegB64 } }] });
  }

  async function validate(key) {
    st.data.models = null;
    const m = await discover(key, true);
    const r = await call(m.fast[0], { contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }] }, key)
      .catch(async e => { if (e instanceof KeyError) throw e; return call(m.smart[0], { contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }] }, key); });
    return !!r;
  }

  EV.gemini = { generate, text, ask, parseJSON, transcribe, search, vision, tts, validate, discover, KeyError, LimitError };
})();
