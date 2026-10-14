/* Spotify on the phone: the Web API with the phone's own login (handed over once from the laptop,
   PKCE, no secret). Plays on the iPhone's Spotify app. Without a login it opens Spotify's search. */
(function () {
  const st = EV.store, API = 'https://api.spotify.com/v1';

  function connected() { return !!(st.data.spotify && st.data.spotify.refresh_token); }

  async function token() {
    const s = st.data.spotify;
    if (!s) throw new Error('not connected');
    if (s.access_token && s.expires_at > Date.now() / 1000 + 60) return s.access_token;
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: s.client_id }) });
    if (!r.ok) { if (r.status === 400) { st.data.spotify = null; st.save(); } throw new Error('Spotify login expired. Reconnect it from the laptop install page.'); }
    const j = await r.json();
    s.access_token = j.access_token; s.expires_at = Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    if (j.refresh_token) s.refresh_token = j.refresh_token;           // PKCE refresh tokens rotate
    st.save(); return s.access_token;
  }
  async function api(path, opts = {}) {
    const r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + await token(),
      'Content-Type': 'application/json' }, opts.headers || {}) }));
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error?.message || ('Spotify error ' + r.status)); e.status = r.status; e.reason = j.error?.reason; throw e; }
    return j;
  }

  let cache = { t: 0, lists: [] };
  async function myPlaylists() {
    if (Date.now() - cache.t < 600000 && cache.lists.length) return cache.lists;
    let out = [], url = '/me/playlists?limit=50';
    for (let i = 0; i < 4 && url; i++) { const j = await api(url); out = out.concat(j.items || []); url = j.next ? j.next.replace(API, '') : null; }
    cache = { t: Date.now(), lists: out.filter(Boolean) }; return cache.lists;
  }
  const norm = s => String(s || '').toLowerCase().replace(/\b(my|the|playlist|songs?)\b/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  function fuzzy(q, list) {
    const n = norm(q); if (!n) return null;
    let best = null, score = 0;
    for (const p of list) {
      const m = norm(p.name); let s = m === n ? 3 : m.includes(n) || n.includes(m) ? 2 : 0;
      if (!s) { const a = new Set(n.split(' ')), b = m.split(' '); s = b.filter(w => a.has(w)).length / Math.max(a.size, 1); }
      if (s > score) { score = s; best = p; }
    }
    return score >= .5 ? best : null;
  }

  async function device() {
    const j = await api('/me/player/devices');
    const d = (j.devices || []);
    return d.find(x => x.is_active) || d.find(x => /smartphone/i.test(x.type)) || d[0] || null;
  }

  async function play(query, kind) {
    if (!connected()) return fallback(query);
    let body = null, label = '';
    const q = String(query || '').trim(), k = (kind || '').toLowerCase();
    if (/liked|favourite|favorite|saved/i.test(q) || k === 'liked') {
      const j = await api('/me/tracks?limit=50');
      const uris = (j.items || []).map(i => i.track?.uri).filter(Boolean).sort(() => Math.random() - .5);
      body = { uris }; label = 'your liked songs';
    } else {
      const mine = (k === 'playlist' || /playlist|\bmy\b/i.test(q)) ? fuzzy(q, await myPlaylists()) : null;
      if (mine) { body = { context_uri: mine.uri }; label = 'your playlist ' + mine.name; }
      else {
        const type = ['track', 'artist', 'album', 'playlist'].includes(k) ? k : 'track,artist,playlist';
        const j = await api('/search?' + new URLSearchParams({ q, type, limit: '5' }));
        const tr = j.tracks?.items?.[0], ar = j.artists?.items?.[0], pl = j.playlists?.items?.find(Boolean), al = j.albums?.items?.[0];
        if (k === 'artist' && ar) { body = { context_uri: ar.uri }; label = ar.name; }
        else if (k === 'album' && al) { body = { context_uri: al.uri }; label = al.name + ' by ' + al.artists[0].name; }
        else if (k === 'playlist' && pl) { body = { context_uri: pl.uri }; label = 'the playlist ' + pl.name; }
        else if (tr) { body = { uris: [tr.uri] }; label = tr.name + ' by ' + tr.artists.map(a => a.name).join(', '); }
        else if (ar) { body = { context_uri: ar.uri }; label = ar.name; }
        else return { error: `Spotify found nothing for "${q}".` };
      }
    }
    const dev = await device();
    if (!dev) return { needs_tap: true, open: 'spotify:', label,
      result: `Spotify isn't open on the phone yet. Tap "Open Spotify", then ask again and I'll start ${label}.` };
    try {
      await api('/me/player/play?device_id=' + dev.id, { method: 'PUT', body: JSON.stringify(body) });
    } catch (e) {
      if (e.reason === 'PREMIUM_REQUIRED') return { error: 'Playing from E.V. needs Spotify Premium.' };
      throw e;
    }
    return { result: `Playing ${label} on ${dev.name}.` };
  }

  async function control(action, value) {
    if (!connected()) return { needs_tap: true, open: 'spotify:', result: 'Spotify control needs the Spotify login from the laptop install. I can open Spotify for you.' };
    const map = { pause: ['PUT', '/me/player/pause'], resume: ['PUT', '/me/player/play'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };
    if (map[action]) { await api(map[action][1], { method: map[action][0] }); return { result: { pause: 'Paused.', resume: 'Playing.', next: 'Skipped.', previous: 'Back one.' }[action] }; }
    if (action === 'volume') { await api('/me/player/volume?volume_percent=' + Math.max(0, Math.min(100, parseInt(value) || 50)), { method: 'PUT' }); return { result: 'Volume ' + value + '.' }; }
    if (action === 'shuffle') { const on = value === true || /on|true|yes/i.test(String(value)); await api('/me/player/shuffle?state=' + on, { method: 'PUT' }); return { result: 'Shuffle ' + (on ? 'on.' : 'off.') }; }
    if (action === 'now_playing') return nowPlaying();
    return { error: 'unknown Spotify action ' + action };
  }
  async function nowPlaying() {
    if (!connected()) return { result: 'Spotify is not connected on the phone.' };
    const j = await api('/me/player/currently-playing');
    if (!j || !j.item) return { result: 'Nothing is playing.', playing: false };
    return { playing: !!j.is_playing, track: j.item.name, artist: (j.item.artists || []).map(a => a.name).join(', '),
             art: j.item.album?.images?.[1]?.url || j.item.album?.images?.[0]?.url || '', progress: j.progress_ms, duration: j.item.duration_ms };
  }
  function fallback(q) {
    return { needs_tap: true, open: 'https://open.spotify.com/search/' + encodeURIComponent(q || ''),
             result: `Spotify control isn't connected on the phone, so I've got Spotify's search for "${q}" ready. Tap to open it and press play.` };
  }

  EV.spotify = { connected, play, control, nowPlaying };
})();
