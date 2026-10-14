/* The conversation loop: the user's words (and pictures) + recent chat -> Gemini with phone E.V.'s
   tools -> run the tools it asks for -> its final answer. Tap-to-open actions come back as offers. */
(function () {
  const st = EV.store, G = EV.gemini;

  const KEEP = 20;                                   // messages E.V. always carries word for word
  function history() {
    return st.data.chat.slice(-KEEP).filter(m => m.text && m.text !== '(spoke)')
      .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  }
  function remember(role, text) {
    if (!text) return;
    st.data.chat.push({ role, text: String(text).slice(0, 4000), t: Date.now() });
    if (st.data.chat.length > 80) st.data.chat.splice(0, st.data.chat.length - 80);
    st.save();
    summarizeSoon();
  }

  /* older conversation is folded into a short running summary, so E.V. never loses the thread */
  let sumTimer = null, summarizing = false;
  function summarizeSoon() { clearTimeout(sumTimer); sumTimer = setTimeout(summarize, 8000); }
  async function summarize() {
    const chat = st.data.chat, done = st.data.summaryUpto || 0;
    const older = chat.filter(m => m.t > done).slice(0, Math.max(0, chat.filter(m => m.t > done).length - KEEP));
    if (summarizing || older.length < 10 || !st.key.get() || !navigator.onLine) return;
    summarizing = true;
    try {
      const text = await G.ask(`You keep the running memory of an assistant called E.V. Update the summary of the conversation so far.
Keep: topics discussed, what the user wanted, decisions, open questions, names, numbers, plans, and where the latest topic stood.
Write in short sentences, newest topic last, max 180 words. No preamble.

CURRENT SUMMARY:
${st.data.summary || '(none yet)'}

NEW OLDER MESSAGES:
${older.map(m => (m.role === 'user' ? 'User: ' : 'E.V.: ') + m.text).join('\n')}`, { speed: 'fast', temperature: 0.2 });
      if (text) { st.data.summary = text.trim().slice(0, 2000); st.data.summaryUpto = older[older.length - 1].t; st.save(); EV.log('memory: summary updated'); }
    } catch (e) { EV.log('memory: summary failed ' + e.message); }
    summarizing = false;
  }

  /* input: {text, images:[{b64, mime}], hidden:true (a system note, not shown as the user's words)} */
  async function run(input, hooks = {}) {
    const parts = [];
    if (input.text) parts.push({ text: input.hidden ? '[System note, not from the user] ' + input.text : input.text });
    if (input.audio) parts.push({ inlineData: { mimeType: 'audio/wav', data: input.audio } },
      { text: '(The user said this out loud. Reply to what they said, in English unless they asked otherwise.)' });
    (input.images || []).forEach(im => parts.push({ inlineData: { mimeType: im.mime || 'image/jpeg', data: im.b64 } }));
    const contents = [...history(), { role: 'user', parts }];
    const tools = [{ functionDeclarations: EV.tools.declarations() }];
    const offers = [];
    let reply = '';
    for (let step = 0; step < 7; step++) {
      const j = await G.generate({ system: EV.prompt.build(), contents, tools, speed: 'smart' });
      const content = j?.candidates?.[0]?.content;
      if (!content || !content.parts) { reply = G.text(j) || "Hmm, I lost my train of thought. Say that again?"; break; }
      contents.push(content);
      const calls = content.parts.filter(p => p.functionCall).map(p => p.functionCall);
      if (!calls.length) { reply = G.text(j); break; }
      const responses = [];
      for (const c of calls) {
        hooks.onTool && hooks.onTool(c.name);
        const out = await EV.tools.run(c.name, c.args || {});
        if (out && out.needs_tap) offers.push({ label: out.label || 'Open', url: out.open || '', action: out.action || '', question: out.question || '' });
        responses.push({ functionResponse: { name: c.name, response: out && typeof out === 'object' ? out : { result: String(out) } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    if (!input.hidden) {
      remember('user', input.text || (input.audio ? '(spoke)' : input.images && input.images.length ? '(sent a picture)' : ''));
      const entry = st.data.chat[st.data.chat.length - 1];
      if (!input.text && input.transcript) input.transcript.then(t => { if (t && entry) { entry.text = t; st.save(); } }).catch(() => {});   // filled in when ready, no waiting
    }
    remember('ev', reply);
    return { reply, offers };
  }

  EV.agent = { run, remember, history };
})();
