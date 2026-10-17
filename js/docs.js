/* Documents made on the phone: PDFs, mind maps (flat + 3D views + outline in one PDF, like the
   laptop) and PowerPoint presentations in the same 16 designs. Libraries load only when needed. */
(function () {
  const loaded = {};
  function lib(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
    return loaded[src];
  }
  const jspdf = async () => { await lib('vendor/jspdf.umd.min.js'); return window.jspdf.jsPDF; };
  const pptx = async () => { await lib('vendor/pptxgen.bundle.js'); return window.PptxGenJS; };
  const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const plain = s => safe(String(s || '').replace(/\*\*/g, ''));
  const safe = s => String(s || '').replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '');
  const fname = (t, ext) => (String(t || 'E.V.').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'EV') +
    '_' + new Date().toISOString().slice(0, 10) + '.' + ext;

  /* ---------------- PDF document ---------------- */
  // doc: {title, subtitle, sections:[{heading, paragraphs[], bullets[]}], sources:[{title,url}]}
  async function pdf(doc) {
    const J = await jspdf();
    const p = new J({ unit: 'pt', format: 'a4' }), W = 595, H = 842, M = 54;
    let y = 0;
    const header = () => {
      p.setFillColor(9, 14, 33); p.rect(0, 0, W, 112, 'F');
      p.setFillColor(240, 44, 72); p.rect(0, 112, W, 4, 'F');
      p.setTextColor(243, 245, 255); p.setFont('helvetica', 'bolditalic'); p.setFontSize(24);
      p.text(p.splitTextToSize(safe(doc.title).toUpperCase(), W - 2 * M).slice(0, 2), M, 52);
      p.setFont('helvetica', 'normal'); p.setFontSize(10); p.setTextColor(152, 165, 197);
      p.text(safe(doc.subtitle || ('Prepared by E.V. · ' + today())), M, 96);
      y = 146;
    };
    const need = h => { if (y + h > H - 60) { footer(); p.addPage(); y = 64; } };
    const footer = () => { p.setFontSize(8); p.setTextColor(140, 150, 175); p.text('E.V. · ' + safe(doc.title), M, H - 28);
      p.text(String(p.getNumberOfPages()), W - M, H - 28, { align: 'right' }); };
    header();
    if (doc.one_line) {                                   // the whole idea in one sentence, in a soft box
      p.setFont('helvetica', 'bold'); p.setFontSize(12);
      const L = p.splitTextToSize(plain(doc.one_line), W - 2 * M - 28);
      p.setFillColor(255, 241, 243); p.rect(M, y - 14, W - 2 * M, L.length * 16 + 16, 'F');
      p.setFillColor(240, 44, 72); p.rect(M, y - 14, 4, L.length * 16 + 16, 'F');
      p.setTextColor(30, 34, 52); L.forEach(l => { p.text(l, M + 16, y + 2); y += 16; }); y += 22;
    }
    for (const s of doc.sections || []) {
      if (s.heading) {
        need(40); p.setFont('helvetica', 'bold'); p.setFontSize(14); p.setTextColor(240, 44, 72);
        p.text(plain(s.heading), M, y); y += 20;
      }
      p.setFont('helvetica', 'normal'); p.setFontSize(11); p.setTextColor(30, 34, 52);
      for (const para of s.paragraphs || []) {
        const lines = p.splitTextToSize(plain(para), W - 2 * M);
        for (const l of lines) { need(15); p.text(l, M, y); y += 15; }
        y += 6;
      }
      (s.steps || []).forEach((st_, n) => {
        const lines = p.splitTextToSize(plain(st_), W - 2 * M - 22);
        lines.forEach((l, i) => { need(15); if (!i) { p.setFont('helvetica', 'bold'); p.setTextColor(240, 44, 72); p.text((n + 1) + '.', M, y); p.setFont('helvetica', 'normal'); p.setTextColor(30, 34, 52); } p.text(l, M + 22, y); y += 15; });
        y += 4;
      });
      for (const b of s.bullets || []) {
        const lines = p.splitTextToSize(plain(b), W - 2 * M - 16);
        lines.forEach((l, i) => { need(15); if (!i) { p.setFillColor(63, 139, 255); p.circle(M + 4, y - 4, 2, 'F'); } p.text(l, M + 16, y); y += 15; });
        y += 3;
      }
      y += 10;
    }
    if ((doc.sources || []).length) {
      need(40); p.setFont('helvetica', 'bold'); p.setFontSize(12); p.setTextColor(240, 44, 72); p.text('Sources', M, y); y += 18;
      p.setFont('helvetica', 'normal'); p.setFontSize(9); p.setTextColor(80, 90, 120);
      doc.sources.forEach((s, i) => { const l = p.splitTextToSize(`${i + 1}. ${safe(s.title)} ${s.url || ''}`, W - 2 * M); l.forEach(x => { need(12); p.text(x, M, y); y += 12; }); });
    }
    footer();
    return { blob: p.output('blob'), name: fname(doc.title, 'pdf') };
  }

  async function imagesToPdf(files, title) {
    const J = await jspdf();
    let p = null;
    for (const f of files) {
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const land = img.width > img.height, W = land ? 842 : 595, H = land ? 595 : 842;
      if (!p) p = new J({ unit: 'pt', format: 'a4', orientation: land ? 'l' : 'p' }); else p.addPage('a4', land ? 'l' : 'p');
      const k = Math.min((W - 40) / img.width, (H - 40) / img.height);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      p.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    }
    return { blob: p.output('blob'), name: fname(title || 'Images', 'pdf') };
  }

  async function textToPdf(title, text) {
    return pdf({ title, sections: [{ paragraphs: String(text).split(/\n{2,}/) }] });
  }

  /* ---------------- mind map ---------------- */
  const PALETTE = ['#ff2b3d', '#ff7a2e', '#8a5cff', '#3f7dff', '#7fe6ff', '#ff5a8a', '#5dcaa5', '#ffc857'];
  const FONT = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
  function build(spec) {
    const root = { name: spec.title || 'Mind map', level: 0, children: [], x: 0, y: 0, z: 0 };
    (spec.branches || []).forEach((b, i) => {
      const col = PALETTE[i % PALETTE.length];
      const n1 = { name: b.name || '?', level: 1, parent: root, color: col, children: [] }; root.children.push(n1);
      (b.children || []).forEach(c => {
        const n2 = { name: c.name || '?', level: 2, parent: n1, color: col, children: [] }; n1.children.push(n2);
        (c.children || []).forEach(g => n2.children.push({ name: g.name || '?', level: 3, parent: n2, color: col, children: [] }));
      });
    });
    return root;
  }
  const leaves = n => n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1;
  function* walk(n) { yield n; for (const c of n.children) yield* walk(c); }
  function layout(root) {
    const radii = [0, 430, 820, 1120], sx = 1.45, sy = 1.0;
    const place = (n, a0, a1) => {
      n.angle = (a0 + a1) / 2; const r = radii[Math.min(n.level, 3)];
      n.x = Math.cos(n.angle) * r * sx; n.y = Math.sin(n.angle) * r * sy;
      let a = a0;
      for (const c of n.children) { const span = (a1 - a0) * leaves(c) / Math.max(1, leaves(n)); place(c, a, a + span); a += span; }
    };
    const start = -Math.PI / 2 - Math.PI / Math.max(3, root.children.length);
    place(root, start, start + 2 * Math.PI); root.x = root.y = 0;
    root.children.forEach((b, i) => {                       // lift it into 3D for the rendered views
      const tilt = ((i % 3) - 1) * 0.55 + (i % 2 ? 0.25 : -0.25);
      for (const n of walk(b)) n.z = tilt * 260 * n.level + Math.sin(n.angle * 3) * 80 * (n.level - 1);
    });
    root.z = 0;
  }
  function background(c, W, H) {
    c.fillStyle = '#04050d'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * .75);
    g.addColorStop(0, '#46143a'); g.addColorStop(.35, '#281232'); g.addColorStop(.7, '#120c26'); g.addColorStop(1, '#04050d');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < W * H / 9000; i++) { const b = 60 + rnd() * 120; c.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`; c.fillRect(rnd() * W, rnd() * H, 2, 2); }
  }
  function wrap(c, text, maxw, lines = 3) {
    const out = []; let cur = '';
    for (const w of String(text).split(/\s+/)) { const t = (cur + ' ' + w).trim(); if (c.measureText(t).width <= maxw || !cur) cur = t; else { out.push(cur); cur = w; } }
    if (cur) out.push(cur); return out.slice(0, lines);
  }
  function renderFlat(root, W = 2700, H = 1800) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    background(c, W, H);
    const cx = W / 2, cy = H / 2, s = W / 3600;
    const all = [...walk(root)];
    const k = Math.min((W / 2 - 330 * s) / Math.max(1, ...all.map(n => Math.abs(n.x))), (H / 2 - 140 * s) / Math.max(1, ...all.map(n => Math.abs(n.y))), s);
    const P = n => [cx + n.x * k, cy + n.y * k];
    c.lineCap = 'round';
    for (const glow of [true, false]) for (const n of all) {
      if (!n.parent) continue;
      const [ax, ay] = P(n.parent), [bx, by] = P(n), d = Math.hypot(bx - ax, by - ay) * .45;
      const c1 = n.parent.level ? [ax + Math.cos(n.angle) * d, ay + Math.sin(n.angle) * d] : [ax, ay];
      const c2 = [bx - Math.cos(n.angle) * d * .6, by - Math.sin(n.angle) * d * .6];
      c.strokeStyle = n.color; c.lineWidth = Math.max(3, 14 - n.level * 4) * s * (glow ? 2.6 : 1);
      c.globalAlpha = glow ? .28 : 1; c.filter = glow ? `blur(${10 * s}px)` : 'none';
      c.beginPath(); c.moveTo(ax, ay); c.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], bx, by); c.stroke();
    }
    c.globalAlpha = 1; c.filter = 'none';
    const fs = { 0: 64, 1: 40, 2: 31, 3: 26 };
    for (const n of all) {
      const [x, y] = P(n), lv = Math.min(n.level, 3), col = n.color || '#ff2b3d';
      c.font = `${lv <= 2 ? 700 : 500} ${fs[lv] * s}px ${FONT}`;
      if (n.level <= 1) {
        const ls = wrap(c, n.level ? n.name : n.name.toUpperCase(), (n.level ? 330 : 520) * s), lh = fs[lv] * s * 1.15;
        const tw = Math.max(...ls.map(l => c.measureText(l).width)), pw = tw + (n.level ? 56 : 90) * s, ph = lh * ls.length + (n.level ? 34 : 60) * s;
        c.fillStyle = n.level ? '#161e58' : '#2e143c'; c.strokeStyle = col; c.lineWidth = (n.level ? 5 : 7) * s;
        c.beginPath(); c.roundRect(x - pw / 2, y - ph / 2, pw, ph, n.level ? ph / 2 : 40 * s); c.fill(); c.stroke();
        c.fillStyle = '#e9efff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        ls.forEach((l, i) => c.fillText(l, x, y - lh * ls.length / 2 + lh * i + lh / 2));
      } else {
        const r = (n.level === 2 ? 11 : 8) * s;
        c.fillStyle = '#04050d'; c.strokeStyle = col; c.lineWidth = 4 * s; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
        const left = x < cx, ls = wrap(c, n.name, (n.level === 2 ? 340 : 300) * s), lh = fs[lv] * s * 1.12, tx = left ? x - r - 12 * s : x + r + 12 * s;
        c.textAlign = left ? 'right' : 'left'; c.textBaseline = 'middle';
        ls.forEach((l, i) => { const ty = y - lh * (ls.length - 1) / 2 + lh * i; c.fillStyle = '#000'; c.fillText(l, tx + 2 * s, ty + 2 * s);
          c.fillStyle = n.level === 2 ? '#e9efff' : '#cdd6f5'; c.fillText(l, tx, ty); });
      }
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = `500 ${26 * s}px ${FONT}`; c.fillStyle = '#7882af';
    c.fillText('E.V. mind map · ' + today(), 60 * s, H - 50 * s);
    return cv;
  }
  function render3d(root, yaw, pitch, title, W = 2700, H = 1800) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    background(c, W, H);
    const S = W / 3600, cx = W / 2, cy = H / 2 + 60 * S, all = [...walk(root)];
    const span = Math.max(1, ...all.map(n => Math.abs(n.x)), ...all.map(n => Math.abs(n.y))), sc = 1850 / span, D = 3600, F = 2600;
    const rot = (x, y, z) => { const cy_ = Math.cos(yaw), sy = Math.sin(yaw); [x, z] = [x * cy_ + z * sy, -x * sy + z * cy_];
      const cp = Math.cos(pitch), sp = Math.sin(pitch); [y, z] = [y * cp - z * sp, y * sp + z * cp]; return [x, y, z]; };
    const proj = (x, y, z) => { const [a, b, d] = rot(x * sc, y * sc * .9, z * sc); const s = F / (d + D); return [cx + a * s * S, cy + b * s * S, d, s]; };
    const fy = 780 / sc;                                         // floor grid for depth
    c.lineWidth = 2 * S;
    for (let i = -10; i <= 10; i++) {
      let a = proj(i * 160 / sc * 1.4, fy, -1600 / sc), b = proj(i * 160 / sc * 1.4, fy, 1600 / sc);
      c.strokeStyle = 'rgba(63,125,255,.15)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      a = proj(-1600 / sc * 1.4, fy, i * 160 / sc); b = proj(1600 / sc * 1.4, fy, i * 160 / sc);
      c.strokeStyle = 'rgba(138,92,255,.15)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    const pr = new Map(all.map(n => [n, proj(n.x, n.y, n.z)]));
    const zs = all.map(n => pr.get(n)[2]), zmin = Math.min(...zs), zmax = Math.max(...zs) + 1e-6, depth = z => 1 - (z - zmin) / (zmax - zmin);
    const far = [...all].sort((a, b) => pr.get(b)[2] - pr.get(a)[2]);
    for (const glow of [true, false]) for (const n of far) {
      if (!n.parent) continue;
      const a = pr.get(n.parent), b = pr.get(n), dep = depth((a[2] + b[2]) / 2);
      c.strokeStyle = n.color; c.globalAlpha = (110 + 145 * dep) / 255 * (glow ? .35 : 1); c.filter = glow ? `blur(${10 * S}px)` : 'none';
      c.lineWidth = Math.max(2, (12 - n.level * 3) * (a[3] + b[3]) / 2 * 1.3) * S * (glow ? 2.4 : 1);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 30 * b[3] * S;
      c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(mx, my, b[0], b[1]); c.stroke();
    }
    c.globalAlpha = 1; c.filter = 'none';
    for (const n of far) {
      const [x, y, z, s] = pr.get(n), dep = depth(z), col = n.color || '#ff2b3d', lv = Math.min(n.level, 3);
      const r = { 0: 80, 1: 44, 2: 26, 3: 18 }[lv] * s * 1.25 * S;
      const halo = c.createRadialGradient(x, y, 0, x, y, r * 2.4); halo.addColorStop(0, col + '88'); halo.addColorStop(1, col + '00');
      c.fillStyle = halo; c.globalAlpha = .5 + dep * .5; c.beginPath(); c.arc(x, y, r * 2.4, 0, 7); c.fill(); c.globalAlpha = 1;
      const sph = c.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r);
      sph.addColorStop(0, '#ffffff'); sph.addColorStop(.25, col); sph.addColorStop(1, shade(col, .35));
      c.fillStyle = sph; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      const fs = { 0: 58, 1: 38, 2: 29, 3: 24 }[lv] * Math.min(1.35, Math.max(.7, s * 1.1)) * S;
      if (fs < 16 * S) continue;
      let text = n.level === 0 ? n.name.toUpperCase() : n.name; if (text.length > 34) text = text.slice(0, 32) + '…';
      c.font = `${n.level <= 2 ? 700 : 500} ${fs}px ${FONT}`; c.textBaseline = 'middle';
      c.textAlign = n.level === 0 ? 'center' : 'left';
      const tx = n.level === 0 ? x : x + r + 10 * S, ty = n.level === 0 ? y + r + fs * .9 : y;
      c.globalAlpha = (150 + 105 * dep) / 255; c.fillStyle = '#000'; c.fillText(text, tx + 2 * S, ty + 2 * S);
      c.fillStyle = '#e9efff'; c.fillText(text, tx, ty); c.globalAlpha = 1;
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = `500 ${28 * S}px ${FONT}`; c.fillStyle = '#7882af';
    c.fillText(title + ' · 3D view', 60 * S, H - 50 * S);
    return cv;
  }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16 & 255) * k | 0},${(n >> 8 & 255) * k | 0},${(n & 255) * k | 0})`; }

  async function mindmap(spec, wantJpg) {
    const J = await jspdf();
    const root = build(spec); layout(root);
    const flat = renderFlat(root);
    const views = [['front', 0, .22], ['from the right', .62, .42], ['from the left', -.7, .3]].map(([t, yaw, pitch]) => [t, render3d(root, yaw, pitch, root.name)]);
    const p = new J({ unit: 'pt', format: [842, 595], orientation: 'l' });
    const page = (cv, caption, first) => {
      if (!first) p.addPage([842, 595], 'l');
      p.setFillColor(4, 5, 13); p.rect(0, 0, 842, 595, 'F');
      p.addImage(cv.toDataURL('image/jpeg', .9), 'JPEG', 0, 18, 842, 842 * cv.height / cv.width);
      p.setTextColor(233, 239, 255); p.setFont('helvetica', 'bold'); p.setFontSize(12); p.text(safe(caption), 24, 16);
    };
    page(flat, root.name + ' · mind map', true);
    views.forEach(([t, cv]) => page(cv, root.name + ' · 3D view ' + t));
    p.addPage('a4', 'p');                                           // outline
    let y = 70; p.setFont('helvetica', 'bolditalic'); p.setFontSize(22); p.setTextColor(240, 44, 72); p.text(safe(root.name), 50, y); y += 22;
    p.setFont('helvetica', 'normal'); p.setFontSize(9); p.setTextColor(120, 130, 160); p.text('Mind map outline · prepared by E.V. · ' + today(), 50, y); y += 26;
    const line = (t, lv) => { if (y > 790) { p.addPage('a4', 'p'); y = 60; } p.setFont('helvetica', lv === 1 ? 'bold' : 'normal');
      p.setFontSize(lv === 1 ? 13 : 11); p.setTextColor(30, 34, 52); p.text((lv > 1 ? '• ' : '') + safe(t), 50 + (lv - 1) * 18, y); y += lv === 1 ? 20 : 16; };
    for (const b of root.children) { line(b.name, 1); for (const c of b.children) { line(c.name, 2); for (const g of c.children) line(g.name, 3); } y += 6; }
    const out = [{ blob: p.output('blob'), name: fname(root.name + ' mind map', 'pdf') }];
    if (wantJpg) out.push({ blob: await new Promise(r => flat.toBlob(r, 'image/jpeg', .92)), name: fname(root.name + ' mind map', 'jpg') });
    return out;
  }

  /* ---------------- Word documents (.docx) ---------------- */
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files, type) {                       // stored (uncompressed) zip: [{name, text}]
    const enc = new TextEncoder(), out = [], cen = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), d = enc.encode(f.text), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, name.length, true);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      out.push(new Uint8Array(h.buffer), name, d); cen.push(new Uint8Array(c.buffer), name); off += 30 + name.length + d.length;
    }
    const size = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...out, ...cen, new Uint8Array(e.buffer)], { type });
  }
  const xe = s => String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const runs = t => String(t || '').split('**').map((x, i) => x ? `<w:r>${i % 2 ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xe(x)}</w:t></w:r>` : '').join('');
  const para = (style, t, lead) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${lead ? `<w:r><w:rPr><w:b/><w:color w:val="E11D48"/></w:rPr><w:t xml:space="preserve">${xe(lead)}</w:t></w:r>` : ''}${runs(t)}</w:p>`;
  // doc: {title, subtitle, one_line, sections:[{heading, paragraphs[], bullets[], steps[]}], sources:[{title,url}]}
  async function docx(doc) {
    let body = para('Title', doc.title || 'Notes') + para('Subtitle', doc.subtitle || ('Prepared by E.V. · ' + today()));
    if (doc.one_line) body += para('Callout', doc.one_line);
    for (const sc of doc.sections || []) {
      if (sc.heading) body += para('Heading1', sc.heading);
      (sc.paragraphs || []).forEach(t => { body += para('', t); });
      (sc.steps || []).forEach((t, i) => { body += para('Bullet', t, (i + 1) + '.  '); });
      (sc.bullets || []).forEach(t => { body += para('Bullet', t, '•  '); });
    }
    if ((doc.sources || []).length) { body += para('Heading1', 'Sources'); doc.sources.forEach((x, i) => { body += para('Small', `${i + 1}. ${x.title || ''} ${x.url || ''}`); }); }
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    const styles = `${X}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="1F2937"/></w:rPr></w:style>`
      + st('Title', 'Title', '<w:spacing w:after="40"/>', '<w:b/><w:color w:val="0F172A"/><w:sz w:val="48"/><w:szCs w:val="48"/>')
      + st('Subtitle', 'Subtitle', '<w:spacing w:after="280"/>', '<w:color w:val="6B7280"/><w:sz w:val="21"/>')
      + st('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="300" w:after="100"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="E11D48"/><w:sz w:val="30"/><w:szCs w:val="30"/>')
      + st('Callout', 'Callout', '<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="E11D48"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF1F3"/><w:spacing w:before="80" w:after="240"/><w:ind w:left="170" w:right="113"/>', '<w:b/><w:sz w:val="25"/>')
      + st('Bullet', 'List Item', '<w:spacing w:after="80"/><w:ind w:left="567" w:hanging="340"/>', '')
      + st('Small', 'Small', '<w:spacing w:after="40"/>', '<w:color w:val="6B7280"/><w:sz w:val="18"/>') + '</w:styles>';
    const files = [
      { name: '[Content_Types].xml', text: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: '_rels/.rels', text: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: 'docProps/core.xml', text: `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(doc.title)}</dc:title><dc:creator>E.V.</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>` },
      { name: 'word/_rels/document.xml.rels', text: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'word/styles.xml', text: styles },
      { name: 'word/document.xml', text: `${X}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    ];
    return { blob: zip(files, DOCX), name: fname(doc.title, 'docx') };
  }
  /* the same notes as a page on the E.V. screen (the "Open" button) */
  function docHtml(doc) {
    const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const b = t => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    let o = `<article class="doc"><h1>${b(doc.title)}</h1><p class="sub">${h(doc.subtitle || '')}</p>${doc.one_line ? `<p class="callout">${b(doc.one_line)}</p>` : ''}`;
    for (const sc of doc.sections || []) {
      if (sc.heading) o += `<h2>${b(sc.heading)}</h2>`;
      (sc.paragraphs || []).forEach(t => { o += `<p>${b(t)}</p>`; });
      if ((sc.steps || []).length) o += '<ol>' + sc.steps.map(t => `<li>${b(t)}</li>`).join('') + '</ol>';
      if ((sc.bullets || []).length) o += '<ul>' + sc.bullets.map(t => `<li>${b(t)}</li>`).join('') + '</ul>';
    }
    return o + '</article>';
  }

  /* ---------------- presentations ---------------- */
  const THEMES = [
    ['ev', 'E.V. Night', '04050d', '1c1030', 'e9efff', 'b9c6f5', 'ff2b3d', '3f7dff', 'Arial', 'ev'],
    ['neon', 'Midnight Neon', '0a0014', '1a0038', 'f5f3ff', 'c4b5fd', 'ff2bd6', '00e5ff', 'Arial', 'glow'],
    ['aurora', 'Aurora', '06201f', '1b1446', 'effffa', 'a7e8d8', '5dfdcb', 'b28dff', 'Arial', 'circles'],
    ['minimal', 'Minimal White', 'ffffff', 'ffffff', '1b1f33', '6b7090', '3f7dff', 'ff2b3d', 'Arial', 'minimal'],
    ['corporate', 'Corporate Blue', 'f4f7fc', 'e8eef9', '10223f', '51607a', '1f5fbf', '00a3a3', 'Calibri', 'bars'],
    ['sunset', 'Sunset', '2b0f2e', '7a2a2a', 'fff4ea', 'ffd3b0', 'ffd166', 'ff7a2e', 'Georgia', 'wave'],
    ['forest', 'Forest', '0f2418', '1e3d2a', 'f1f8ec', 'bfd8b4', '9be564', 'f2c14e', 'Georgia', 'diagonal'],
    ['ocean', 'Ocean', '031a2f', '0b4f6c', 'eaf8ff', '9fd3ea', '4cc9f0', 'f72585', 'Arial', 'wave'],
    ['royal', 'Royal Gold', '0e0e10', '1d1a14', 'f7f1e1', 'cbbf9e', 'd4af37', 'f5e6b3', 'Palatino', 'frame'],
    ['pastel', 'Pastel Dream', 'fdf2f8', 'eef4ff', '3b2a44', '7a6685', 'f472b6', '60a5fa', 'Arial', 'circles'],
    ['mono', 'Monochrome', '111111', '1c1c1c', 'f2f2f2', 'a0a0a0', 'ffffff', '7a7a7a', 'Arial Black', 'minimal'],
    ['retro', 'Retro 80s', '1a0b2e', '3d1466', 'fff0fb', 'f5b8e6', 'ff6ec7', 'fcee0c', 'Arial', 'grid'],
    ['blueprint', 'Blueprint', '0b3d91', '0a3480', 'e8f1ff', 'b5cdf5', 'ffffff', 'ffd166', 'Courier New', 'grid'],
    ['crimson', 'Crimson Bold', '1a0507', '4a0d14', 'fff1f1', 'f2b8bc', 'ff2b3d', 'ffb3b3', 'Arial Black', 'diagonal'],
    ['mint', 'Mint Fresh', 'effaf5', 'e6f6fb', '0f3d2e', '4b7266', '10b981', '0ea5e9', 'Arial', 'dots'],
    ['galaxy', 'Galaxy', '05010f', '1b0b3a', 'f3eefe', 'c9b8f5', 'a78bfa', 'f0abfc', 'Arial', 'stars']
  ].map(([id, name, bg1, bg2, text, muted, accent, accent2, font, deco]) => ({ id, name, bg1, bg2, text, muted, accent, accent2, font, deco }));
  function findTheme(q) {
    if (!q) return THEMES[0];
    q = String(q).toLowerCase();
    return THEMES.find(t => t.id === q || t.name.toLowerCase() === q) || THEMES.find(t => t.name.toLowerCase().includes(q) || q.includes(t.id)) || THEMES[0];
  }
  function backdrop(t, big) {                 // gradient + decoration, drawn once per theme as the slide background
    const W = 1600, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#' + t.bg1); g.addColorStop(1, '#' + t.bg2); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const A = '#' + t.accent, B = '#' + t.accent2; c.globalAlpha = .18;
    switch (t.deco) {
      case 'ev': c.strokeStyle = A; c.lineWidth = 2; for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(i / 24 * Math.PI) * 900, Math.sin(i / 24 * Math.PI) * 900); c.stroke(); }
        for (let r = 120; r < 900; r += 110) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI / 2); c.stroke(); } break;
      case 'glow': case 'stars': { const rg = c.createRadialGradient(W * .8, H * .2, 0, W * .8, H * .2, 600); rg.addColorStop(0, A); rg.addColorStop(1, 'transparent'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
        if (t.deco === 'stars') { c.globalAlpha = .7; c.fillStyle = '#fff'; for (let i = 0; i < 160; i++) c.fillRect((i * 997) % W, (i * 613) % H, 2, 2); } break; }
      case 'circles': c.fillStyle = A; c.beginPath(); c.arc(W * .9, H * .15, 260, 0, 7); c.fill(); c.fillStyle = B; c.beginPath(); c.arc(W * .05, H * .95, 200, 0, 7); c.fill(); break;
      case 'bars': c.globalAlpha = 1; c.fillStyle = A; c.fillRect(0, 0, W, 18); c.fillStyle = B; c.fillRect(0, 18, W * .3, 6); break;
      case 'wave': c.fillStyle = A; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 20) c.lineTo(x, H * .82 + Math.sin(x / 140) * 40); c.lineTo(W, H); c.fill(); break;
      case 'diagonal': c.fillStyle = A; c.beginPath(); c.moveTo(W * .7, 0); c.lineTo(W, 0); c.lineTo(W, H * .5); c.fill(); break;
      case 'frame': c.globalAlpha = .6; c.strokeStyle = A; c.lineWidth = 3; c.strokeRect(36, 36, W - 72, H - 72); break;
      case 'grid': c.strokeStyle = B; c.lineWidth = 1; for (let x = 0; x < W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = 0; y < H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        if (t.id === 'retro' && big) { c.globalAlpha = .5; const sg = c.createLinearGradient(0, H * .3, 0, H * .7); sg.addColorStop(0, B); sg.addColorStop(1, A); c.fillStyle = sg; c.beginPath(); c.arc(W / 2, H * .62, 220, Math.PI, 0); c.fill(); } break;
      case 'dots': c.fillStyle = A; for (let x = 40; x < W; x += 50) for (let y = 40; y < H; y += 50) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); } break;
    }
    return cv.toDataURL('image/jpeg', 0.86);          // JPEG keeps the .pptx small
  }
  async function wikiImage(q) {
    try {
      const r = await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', titles: q, prop: 'pageimages',
        pithumbsize: '1200', format: 'json', redirects: '1', origin: '*' }));
      const pages = (await r.json()).query?.pages || {};
      const src = Object.values(pages).map(p => p.thumbnail?.source).find(Boolean);
      if (!src) return null;
      const b = await (await fetch(src)).blob();
      return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    } catch (e) { return null; }
  }
  async function presentation(deck, themeQ, onStep) {
    const P = await pptx(), t = findTheme(themeQ), pres = new P();
    pres.layout = 'LAYOUT_WIDE'; pres.title = deck.title || 'Presentation'; pres.author = 'E.V.';
    const bgBig = backdrop(t, true), bg = backdrop(t, false);
    const TX = t.text, MU = t.muted, AC = t.accent, A2 = t.accent2, F = t.font;
    const W = 13.333, H = 7.5;
    const title = (s, txt, y = .55) => s.addText(String(txt || ''), { x: .7, y, w: W - 1.4, h: .9, fontFace: F, fontSize: 30, bold: true, color: TX, fit: 'shrink' });
    const bullets = (s, list, x, y, w, h, size = 18) => s.addText((list || []).map(b => ({ text: String(b), options: { bullet: { code: '25A0' }, color: TX, paraSpaceAfter: 8 } })),
      { x, y, w, h, fontFace: F, fontSize: size, color: TX, valign: 'top', fit: 'shrink' });
    const accentBar = (s, y = 1.45) => s.addShape(pres.ShapeType.rect, { x: .7, y, w: 1.2, h: .07, fill: { color: AC }, line: { color: AC } });
    const slides = deck.slides || [];
    if (!slides.length || slides[0].layout !== 'title') slides.unshift({ layout: 'title', title: deck.title, subtitle: deck.subtitle });
    for (let i = 0; i < slides.length; i++) {
      const d = slides[i], L = d.layout || 'bullets', s = pres.addSlide();
      onStep && onStep(i, slides.length);
      s.background = { data: (L === 'title' || L === 'closing' || L === 'section') ? bgBig : bg };
      if (L === 'title' || L === 'closing') {
        s.addText(String(d.title || deck.title || ''), { x: .9, y: 2.3, w: W - 1.8, h: 1.8, fontFace: F, fontSize: 44, bold: true, color: TX, fit: 'shrink' });
        s.addShape(pres.ShapeType.rect, { x: .95, y: 4.15, w: 1.6, h: .09, fill: { color: AC }, line: { color: AC } });
        s.addText(String(d.subtitle || (L === 'title' ? 'Prepared by E.V. · ' + today() : 'Thank you')), { x: .9, y: 4.4, w: W - 1.8, h: .8, fontFace: F, fontSize: 20, color: MU });
      } else if (L === 'section') {
        s.addText(String(d.number || ''), { x: .9, y: 1.6, w: 3, h: 1.4, fontFace: F, fontSize: 80, bold: true, color: AC });
        s.addText(String(d.title || ''), { x: .9, y: 3.1, w: W - 1.8, h: 1.2, fontFace: F, fontSize: 38, bold: true, color: TX, fit: 'shrink' });
        s.addText(String(d.subtitle || ''), { x: .9, y: 4.3, w: W - 1.8, h: .8, fontFace: F, fontSize: 18, color: MU });
      } else if (L === 'two_column' || L === 'comparison') {
        title(s, d.title); accentBar(s);
        [['left', .7], ['right', W / 2 + .2]].forEach(([k, x], j) => {
          const col = d[k] || {};
          if (L === 'comparison') s.addShape(pres.ShapeType.roundRect, { x: x - .1, y: 1.8, w: W / 2 - .8, h: 4.9, rectRadius: .15, fill: { color: j ? A2 : AC, transparency: 85 }, line: { color: j ? A2 : AC, width: 1 } });
          s.addText(String(col.heading || ''), { x, y: 1.9, w: W / 2 - 1, h: .6, fontFace: F, fontSize: 22, bold: true, color: j ? A2 : AC });
          bullets(s, col.bullets, x, 2.6, W / 2 - 1, 3.9, 17);
        });
      } else if (L === 'quote') {
        s.addText('“', { x: .8, y: .8, w: 2, h: 2, fontFace: 'Georgia', fontSize: 140, color: AC });
        s.addText(String(d.quote || ''), { x: 1.4, y: 2.0, w: W - 2.8, h: 2.8, fontFace: 'Georgia', fontSize: 30, italic: true, color: TX, fit: 'shrink' });
        s.addText('— ' + (d.author || ''), { x: 1.4, y: 5.0, w: W - 2.8, h: .6, fontFace: F, fontSize: 18, color: MU });
      } else if (L === 'stats') {
        title(s, d.title); accentBar(s);
        const st = (d.stats || []).slice(0, 4), n = Math.max(1, st.length), w = (W - 1.4 - (n - 1) * .3) / n;
        st.forEach((x, j) => {
          const xx = .7 + j * (w + .3);
          s.addShape(pres.ShapeType.roundRect, { x: xx, y: 2.0, w, h: 3.2, rectRadius: .15, fill: { color: AC, transparency: 88 }, line: { color: AC, width: 1 } });
          s.addText(String(x.value || ''), { x: xx, y: 2.3, w, h: 1.6, align: 'center', fontFace: F, fontSize: String(x.value || '').length > 7 ? 34 : 48, bold: true, color: AC, fit: 'shrink' });
          s.addText(String(x.label || ''), { x: xx + .2, y: 3.9, w: w - .4, h: 1.1, align: 'center', fontFace: F, fontSize: 15, color: TX, fit: 'shrink' });
        });
        if (d.note) s.addText(String(d.note), { x: .7, y: 5.6, w: W - 1.4, h: .7, fontFace: F, fontSize: 14, color: MU, italic: true });
      } else if (L === 'timeline') {
        title(s, d.title); accentBar(s);
        const steps = (d.steps || []).slice(0, 6), n = Math.max(1, steps.length), x0 = 2.0, x1 = 11.3;
        s.addShape(pres.ShapeType.line, { x: x0 - .5, y: 3.6, w: x1 - x0 + 1, h: 0, line: { color: MU, width: 2 } });
        steps.forEach((st_, j) => {
          const x = n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * j / (n - 1);
          s.addShape(pres.ShapeType.ellipse, { x: x - .18, y: 3.42, w: .36, h: .36, fill: { color: j % 2 ? A2 : AC }, line: { color: TX, width: 1 } });
          s.addText(String(st_.label || ''), { x: x - 1, y: 2.5, w: 2, h: .7, align: 'center', fontFace: F, fontSize: 16, bold: true, color: j % 2 ? A2 : AC, fit: 'shrink' });
          s.addText(String(st_.text || ''), { x: x - 1, y: 4.0, w: 2, h: 2.2, align: 'center', valign: 'top', fontFace: F, fontSize: 13, color: TX, fit: 'shrink' });
        });
      } else if (L === 'image') {
        title(s, d.title); accentBar(s);
        const img = d.image_query ? await wikiImage(d.image_query) : null;
        bullets(s, d.bullets, .7, 1.9, img ? 6.2 : W - 1.4, 4.8);
        if (img) { s.addImage({ data: img, x: 7.3, y: 1.8, w: 5.3, h: 4.6, sizing: { type: 'cover', w: 5.3, h: 4.6 } });
          s.addText('Image: Wikipedia, ' + d.image_query, { x: 7.3, y: 6.45, w: 5.3, h: .35, fontFace: F, fontSize: 9, color: MU }); }
      } else {
        title(s, d.title); accentBar(s);
        bullets(s, d.bullets, .7, 1.9, W - 1.4, 4.9, 20);
      }
      if (d.notes) s.addNotes(String(d.notes));
      if (L !== 'title') s.addText(String(i + 1), { x: W - 1, y: H - .55, w: .5, h: .35, align: 'right', fontFace: F, fontSize: 10, color: MU });
    }
    const blob = await pres.write({ outputType: 'blob' });
    return { blob, name: fname(deck.title, 'pptx'), theme: t.name, themeId: t.id };
  }

  /* the same slides drawn on the E.V. screen (the "Open" button): positions follow the .pptx above */
  function deckHtml(deck, themeQ) {
    const t = findTheme(themeQ), W = 13.333, H = 7.5, F = t.font, h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const bgBig = backdrop(t, true), bg = backdrop(t, false);
    const pt = n => (n * 100 / 960).toFixed(3) + 'cqw';                     // PowerPoint points -> share of the slide width
    const box = (x, y, w, hh, css, html) => `<div class="bx" style="left:${x / W * 100}%;top:${y / H * 100}%;width:${w / W * 100}%;height:${hh / H * 100}%;${css}">${html}</div>`;
    const txt = (size, color, more = '') => `font-family:${F},sans-serif;font-size:${pt(size)};color:#${color};${more}`;
    const title = d => box(.7, .55, W - 1.4, .9, txt(30, t.text, 'font-weight:700'), h(d.title)) + box(.7, 1.45, 1.2, .07, `background:#${t.accent}`, '');
    const list = (items, x, y, w, hh, size) => box(x, y, w, hh, txt(size, t.text), '<ul>' + (items || []).map(b => `<li>${h(b)}</li>`).join('') + '</ul>');
    const slides = deck.slides || [];
    return slides.map((d, i) => {
      const L = d.layout || 'bullets', big = L === 'title' || L === 'closing' || L === 'section';
      let in_ = '';
      if (L === 'title' || L === 'closing') {
        in_ = box(.9, 2.3, W - 1.8, 1.8, txt(44, t.text, 'font-weight:700;display:flex;align-items:flex-end'), `<span>${h(d.title || deck.title)}</span>`) +
          box(.95, 4.15, 1.6, .09, `background:#${t.accent}`, '') +
          box(.9, 4.4, W - 1.8, .8, txt(20, t.muted), h(d.subtitle || (L === 'title' ? 'Prepared by E.V. · ' + today() : 'Thank you')));
      } else if (L === 'section') {
        in_ = box(.9, 1.6, 3, 1.4, txt(80, t.accent, 'font-weight:700;line-height:1'), h(d.number)) + box(.9, 3.1, W - 1.8, 1.2, txt(38, t.text, 'font-weight:700'), h(d.title)) +
          box(.9, 4.3, W - 1.8, .8, txt(18, t.muted), h(d.subtitle));
      } else if (L === 'two_column' || L === 'comparison') {
        in_ = title(d) + [['left', .7], ['right', W / 2 + .2]].map(([k, x], j) => {
          const col = d[k] || {}, c = j ? t.accent2 : t.accent;
          return (L === 'comparison' ? box(x - .1, 1.8, W / 2 - .8, 4.9, `background:#${c}26;border:1px solid #${c};border-radius:${pt(11)}`, '') : '') +
            box(x, 1.9, W / 2 - 1, .6, txt(22, c, 'font-weight:700'), h(col.heading)) + list(col.bullets, x, 2.6, W / 2 - 1, 3.9, 17);
        }).join('');
      } else if (L === 'quote') {
        in_ = box(.8, .8, 2, 2, `font-family:Georgia,serif;font-size:${pt(140)};color:#${t.accent};line-height:1`, '“') +
          box(1.4, 2.0, W - 2.8, 2.8, `font-family:Georgia,serif;font-style:italic;font-size:${pt(30)};color:#${t.text}`, h(d.quote)) + box(1.4, 5.0, W - 2.8, .6, txt(18, t.muted), '— ' + h(d.author));
      } else if (L === 'stats') {
        const st = (d.stats || []).slice(0, 4), n = Math.max(1, st.length), w = (W - 1.4 - (n - 1) * .3) / n;
        in_ = title(d) + st.map((x, j) => { const xx = .7 + j * (w + .3);
          return box(xx, 2.0, w, 3.2, `background:#${t.accent}1f;border:1px solid #${t.accent};border-radius:${pt(11)}`, '') +
            box(xx, 2.3, w, 1.6, txt(String(x.value || '').length > 7 ? 34 : 48, t.accent, 'font-weight:700;text-align:center'), h(x.value)) +
            box(xx + .2, 3.9, w - .4, 1.1, txt(15, t.text, 'text-align:center'), h(x.label)); }).join('') +
          (d.note ? box(.7, 5.6, W - 1.4, .7, txt(14, t.muted, 'font-style:italic'), h(d.note)) : '');
      } else if (L === 'timeline') {
        const steps = (d.steps || []).slice(0, 6), n = Math.max(1, steps.length), x0 = 2.0, x1 = 11.3;
        in_ = title(d) + box(x0 - .5, 3.59, x1 - x0 + 1, .02, `background:#${t.muted}`, '') + steps.map((q, j) => {
          const x = n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * j / (n - 1), c = j % 2 ? t.accent2 : t.accent;
          return box(x - .18, 3.42, .36, .36, `background:#${c};border-radius:50%;border:1px solid #${t.text}`, '') +
            box(x - 1, 2.5, 2, .7, txt(16, c, 'font-weight:700;text-align:center'), h(q.label)) + box(x - 1, 4.0, 2, 2.2, txt(13, t.text, 'text-align:center'), h(q.text));
        }).join('');
      } else if (L === 'image') {
        in_ = title(d) + list(d.bullets, .7, 1.9, d.image_query ? 6.2 : W - 1.4, 4.8, 18) +
          (d.image_query ? box(7.3, 1.8, 5.3, 4.6, 'border-radius:4px;background:#0003', `<img alt="" data-q="${h(d.image_query)}" style="width:100%;height:100%;object-fit:cover">`) : '');
      } else in_ = title(d) + list(d.bullets, .7, 1.9, W - 1.4, 4.9, 20);
      if (L !== 'title') in_ += box(W - 1, H - .55, .5, .35, txt(10, t.muted, 'text-align:right'), String(i + 1));
      return `<div class="sl" style="background-image:url(${big ? bgBig : bg})">${in_}</div>${d.notes ? `<p class="notes">${h(d.notes)}</p>` : ''}`;
    }).join('');
  }

  EV.docs = { pdf, docx, docHtml, imagesToPdf, textToPdf, mindmap, presentation, deckHtml, wikiImage, THEMES, findTheme, fname, lib };
})();
