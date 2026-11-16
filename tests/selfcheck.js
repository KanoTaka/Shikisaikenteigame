// Self-check: content audit + perfect-player bot + small-screen layout.
// Run: node tests/selfcheck.js   (needs Playwright with Chromium)
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const os = require('os');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'iroken-'));
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const hook = 'renderStrips(); renderHome(); syncSnd();';
if (!src.includes(hook)) throw new Error('hook not found');
const test = src.replace(hook, hook + `
window.__T = { get A() { return A; }, get cur() { if (!A) return null; if (A.def === ACT.remix) return A.phase === 'play' ? A.sub : null; return A; }, get sid() { return A ? (A.def === ACT.remix ? A.sid : A.id) : null; }, ACT, ALLK, NAMES, GENRES, MODES, ACT_MODES, LEVELS, qKnow, qTone, qHue, qName, qMix, qContrast, qSpec, qCurve, qEye, qCones, dist, makeSet, noteAnswer, qNotation, qToneClass, qToneCmp, qCompName, qMunsell, qWaveCmp, qKelvin, qNameRev, qYomi, qEyeFunc, qSafety, qPaletteQ, qCoordQ, qRoomQ, qCVD, qAttr, qAfterimage, qSpinMix, qMixRev, qCoordRev, qGogyo, qContrastDir, qRoomVis, setDiff: d => { QDIFF = d; } };`);
// expose quick-fire generators: wrap quickDef so we can call gen() directly
const test2 = test.replace('function quickDef(cfg) {\n  return {', 'function quickDef(cfg) {\n  return { __gen: cfg.gen,');
const file = path.join(SP, 'selftest.html');
fs.writeFileSync(file, test2);

(async () => {
  const b = await chromium.launch();
  const report = [];
  const P = s => { report.push(s); console.log(s); };

  // ---------- 1. content audit ----------
  {
    const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + file);
    await p.waitForTimeout(300);
    const res = await p.evaluate(() => {
      const T = window.__T, out = [];
      const strip = h => (h || '').replace(/<[^>]+>/g, '').trim();
      // knowledge bank
      const seen = new Map();
      T.ALLK.forEach(k => {
        if (k.opts.length !== 4) out.push(`選択肢が4つでない: ${k.q}`);
        if (new Set(k.opts).size !== k.opts.length) out.push(`選択肢が重複: ${k.q}`);
        if (!T.GENRES.find(g => g.id === k.g)) out.push(`ジャンル不明(${k.g}): ${k.q}`);
        if (!['3', '2', 'UC'].includes(k.lv)) out.push(`級不明: ${k.q}`);
        if (!k.exp) out.push(`解説なし: ${k.q}`);
        if (seen.has(k.q)) out.push(`同じ問題文が2つ: ${k.q}`); seen.set(k.q, 1);
      });
      // option text that appears as the correct answer AND as a wrong answer in a near-identical question
      // generators
      const gens = {}; ['qKnow','qTone','qHue','qName','qMix','qContrast','qSpec','qCurve','qEye','qCones','qNotation','qToneClass','qToneCmp','qCompName','qMunsell','qWaveCmp','qKelvin','qNameRev','qYomi','qEyeFunc','qSafety','qPaletteQ','qCoordQ','qRoomQ','qCVD','qAttr','qAfterimage','qSpinMix','qMixRev','qCoordRev','qGogyo','qContrastDir','qRoomVis'].forEach(n => gens[n] = T[n]);
      const colorOf = h => { const m = (h || '').match(/background:(#[0-9A-Fa-f]{6})/); return m && m[1]; };
      const minD = {};
      for (const [name, g] of Object.entries(gens)) {
        let bad = 0, dupLab = 0, md = 1e9;
        for (let i = 0; i < 600; i++) {
          T.setDiff(i % 3);
          const q = g();
          const nc = q.choices.filter(c => c.correct).length;
          if (nc !== 1) { bad++; if (bad < 3) out.push(`${name}: 正解が${nc}個 → ${strip(q.text)} / ${q.choices.map(c => strip(c.html) || c.cap).join(',')}`); }
          const labs = q.choices.map(c => strip(c.html) + '|' + (c.cap || '') + '|' + ((c.html || '').match(/#[0-9A-Fa-f]{6}/g) || []).join(','));
          if (new Set(labs).size !== labs.length) { dupLab++; if (dupLab < 3) out.push(`${name}: 選択肢の表示が重複 → ${labs.join(' / ')}`); }
          const cols = q.swatch ? q.choices.map(c => colorOf(c.html)).filter(Boolean) : [];
          for (let a = 0; a < cols.length; a++) for (let z = a + 1; z < cols.length; z++) md = Math.min(md, T.dist(cols[a], cols[z]));
        }
        minD[name] = md === 1e9 ? '-' : md.toFixed(1);
      }
      // quick-fire action generators
      for (const id of Object.keys(T.ACT)) {
        const g = T.ACT[id].__gen; if (!g) continue;
        let bad = 0, dupLab = 0, md = 1e9; const fakeA = { n: 5 };
        for (let i = 0; i < 600; i++) {
          const r = g(fakeA);
          const nc = r.options.filter(o => o.correct).length;
          if (nc !== 1) { bad++; if (bad < 3) out.push(`ACT ${id}: 正解が${nc}個 → ${strip(r.prompt)}`); }
          const labs = r.options.map(o => strip(o.html) + '|' + (o.cap || '') + '|' + (o.html ? '' : o.style));
          if (new Set(labs).size !== labs.length) { dupLab++; if (dupLab < 3) out.push(`ACT ${id}: 選択肢が重複 → ${labs.join(' / ')}`); }
          if (!r.reveal || !r.mistake(null).text) out.push(`ACT ${id}: 解説がない`);
          const cols = r.options.map(o => colorOf(o.style)).filter(Boolean);
          if (id === 'karuta') for (let a = 0; a < cols.length; a++) for (let z = a + 1; z < cols.length; z++) md = Math.min(md, T.dist(cols[a], cols[z]));
        }
        if (id === 'karuta') minD['karuta'] = md.toFixed(1);
      }
      // quiz sets
      const modes = [...T.MODES.map(m => m.id), ...T.GENRES.map(g => 'g:' + g.id), ...T.LEVELS.map(l => 'lv:' + l.id)];
      const setDup = {};
      modes.forEach(m => {
        let d = 0, len = 0;
        for (let i = 0; i < 40; i++) { const s = T.makeSet(m); len = Math.min(len || 99, s.length); const keys = s.map(q => q.key); d += keys.length - new Set(keys).size; }
        if (len !== 10) out.push(`${m}: 10問そろわない (${len})`);
        if (d) setDup[m] = (d / 40).toFixed(2);
      });
      // repetition: play 10 sets in a row per mode, answering ~70% correctly
      const rep = {};
      modes.forEach(m => {
        let overlap = 0, all = [];
        let prev = new Set();
        for (let n = 0; n < 10; n++) {
          const set = T.makeSet(m), keys = new Set(set.map(q => q.key));
          if (n) overlap += [...keys].filter(k => prev.has(k)).length;
          set.forEach(q => T.noteAnswer(q, Math.random() < .7)); all.push(...keys); prev = keys;
        }
        rep[m] = `前回と重複 ${(overlap / 9).toFixed(1)}/10・100問中の種類 ${new Set(all).size}`;
      });
      // closest colour-name pairs (for reference)
      const pairs = [];
      for (let a = 0; a < T.NAMES.length; a++) for (let z = a + 1; z < T.NAMES.length; z++) pairs.push([T.dist(T.NAMES[a].hex, T.NAMES[z].hex), T.NAMES[a].name, T.NAMES[z].name]);
      pairs.sort((x, y) => x[0] - y[0]);
      return { out, minD, setDup, rep, closest: pairs.slice(0, 6).map(p => `${p[1]}/${p[2]}=${p[0].toFixed(1)}`), counts: { know: T.ALLK.length, acts: T.ACT_MODES.length } };
    });
    P('=== 1. 問題データの監査 ===');
    P(`知識問題 ${res.counts.know} 問 / アクション ${res.counts.acts} 種`);
    res.out.forEach(x => P('  NG ' + x));
    if (!res.out.length) P('  問題なし');
    P('  色の選択肢どうしの最小距離: ' + JSON.stringify(res.minD));
    P('  1セット内の重複（平均）: ' + JSON.stringify(res.setDup));
    P('  連続10セットの出題の変化:'); Object.entries(res.rep).forEach(([m, v]) => P(`    ${m.padEnd(12)} ${v}`));
    P('  似ている慣用色名ペア: ' + res.closest.join(', '));
    if (errs.length) P('  JS errors: ' + errs.join(' | '));
    await p.close();
  }

  // ---------- 2. perfect-player bot ----------
  const botTap = {
    async quick(p) {
      const pt = await p.evaluate(() => { const A = __T.cur; if (!A || !A.r || A.wait > 0) return null; const i = A.r.options.findIndex(o => o.correct); const b = document.querySelector(`[data-qi="${i}"]`); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, inView: r.bottom <= innerHeight && r.top >= 0 }; });
      return pt;
    },
    async map(p) { return p.evaluate(() => { const A = __T.cur; if (!A || A.wait > 0) return null; const r = document.querySelector(`[data-mt="${A.cur.t}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); },
    async wheel(p) { return p.evaluate(() => { const A = __T.cur; if (!A || A.wait > 0) return null; const svg = document.querySelector('#w-svg'); const a = ((A.cur.ans - 1) * 15 + A.rot + A.spd * 0.05) * Math.PI / 180; const pt = svg.createSVGPoint(); pt.x = 170 + 130 * Math.sin(a); pt.y = 170 - 130 * Math.cos(a); const s = pt.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; }); },
    async spectrum(p) { return p.evaluate(() => { const A = __T.cur; if (!A || A.wait > 0) return null; const q = A.q, sp = document.querySelector('#spec').getBoundingClientRect(); const X = w => sp.left + (w - 380) / 400 * sp.width; const y = sp.top + sp.height / 2;
      if (q.type === 'chip') return { x: X(q.w), y }; if (q.type === 'band') return { x: X((q.B[0] + q.B[1]) / 2), y }; if (q.type === 'range') return { x: X((q.S[1] + q.S[2]) / 2), y };
      const z = document.querySelector(`[data-zone="${q.z}"]`).getBoundingClientRect(); return { x: z.x + z.width / 2, y }; }); },
    async anatomy(p) { return p.evaluate(() => { const A = __T.cur; if (!A || A.wait > 0) return null; const P = { 角膜: [72, 120], 虹彩: [101, 90], 瞳孔: [101, 120], 水晶体: [121, 120], 毛様体: [118, 67], 硝子体: [175, 120], 網膜: [231.6, 52.6], 中心窩: [262, 118], 盲点: [254, 160], 視神経: [300, 182] };
      const svg = document.querySelector('.eye-svg'); const pt = svg.createSVGPoint(); [pt.x, pt.y] = P[A.q[0]]; const s = pt.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y, part: A.q[0] }; }); },
    async rush(p) { return p.evaluate(() => { const A = __T.cur; if (!A) return null; const H = document.querySelector('#field').getBoundingClientRect(); const c = A.chips.find(c => c.ok && !c.hit && !c.el.classList.contains('gone') && c.y > 10 && c.y < H.height - c.size - 20); if (!c) return null; const r = c.el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); },
  };
  async function playLab(p) {
    const st = await p.evaluate(() => { const A = __T.cur; if (!A || A.wait > 0) return null; return [...A.need]; });
    if (!st) return false;
    for (const k of st) await p.tap(`[data-lab="${k}"]`);
    await p.tap('[data-go]');
    return true;
  }
  const quickIds = ['karuta', 'judge', 'signal', 'palette', 'coord', 'light', 'curve', 'cones'];
  async function botRun(dev, label, ids, rounds) {
    const p = await (await b.newContext({ ...dev })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + file); await p.waitForTimeout(300);
    P(`=== 2. 正解し続けるボット（${label}） ===`);
    for (const id of ids) {
      await p.click(`[data-act="${id}"]`);
      await p.waitForTimeout(2900);
      let taps = 0, offscreen = 0, t0 = Date.now(), misses = [];
      while (Date.now() - t0 < (id === 'rush' ? 20000 : id === 'remix' ? 150000 : 60000) && taps < (id === 'remix' ? 40 : rounds)) {
        const st = await p.evaluate(() => __T.A ? { lives: __T.A.lives, running: __T.A.running } : null);
        if (!st || !st.running) break;
        let ok;
        const sid = id === 'remix' ? await p.evaluate(() => __T.cur ? __T.sid : null) : id;
        if (!sid) { await p.waitForTimeout(150); continue; }
        if (sid === 'lab') ok = await playLab(p);
        else {
          const pt = await (quickIds.includes(sid) ? botTap.quick(p) : botTap[sid](p));
          if (pt) { if (pt.inView === false) offscreen++; await p.touchscreen.tap(pt.x, pt.y); ok = true; }
        }
        if (ok) taps++;
        const lv = await p.evaluate(() => __T.A && __T.A.lives);
        if (lv != null && lv < 3 && !misses.length) misses.push(await p.evaluate(() => (__T.A.mistakes.slice(-1)[0] || {}).text || 'TIME'));
        await p.waitForTimeout(id === 'rush' ? 120 : 260);
      }
      const fin = await p.evaluate(() => __T.A ? { score: __T.A.score, lives: __T.A.lives, hits: __T.A.hits, misses: __T.A.misses, combo: __T.A.maxCombo, round: __T.A.round } : { ended: true });
      const verdict = fin.ended ? 'NG 途中で終了' : fin.lives === 3 && fin.hits > 0 ? 'OK' : 'NG';
      P(`  ${verdict.padEnd(4)} ${id.padEnd(9)} 回答${taps} ヒット${fin.hits} ミス${fin.misses} ライフ${fin.lives} スコア${fin.score} 最大コンボ${fin.combo}${fin.round ? ` ラウンド${fin.round}` : ''}${offscreen ? ` 画面外のボタン${offscreen}回` : ''}${misses.length ? ' 最初のミス: ' + misses[0] : ''}`);
      await p.click('#act-quit');
    }
    if (errs.length) P('  JS errors: ' + errs.join(' | '));
    await p.close();
  }
  const all = ['remix', 'rush', 'map', 'wheel', 'karuta', 'lab', 'judge', 'signal', 'palette', 'coord', 'light', 'spectrum', 'curve', 'anatomy', 'cones'];
  await botRun(devices['iPhone 13'], 'iPhone 13', all, 14);

  // ---------- 3. small screens: are all controls on screen? ----------
  for (const [label, dev] of [['iPhone SE', devices['iPhone SE']], ['360x640 Android', { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const p = await (await b.newContext({ ...dev })).newPage();
    await p.goto('file://' + file); await p.waitForTimeout(300);
    P(`=== 3. 小さい画面のレイアウト（${label}） ===`);
    const probs = [];
    for (const id of all) {
      await p.click(`[data-act="${id}"]`);
      await p.waitForTimeout(id === 'remix' ? 4300 : 2900);
      for (let r = 0; r < 4; r++) {
        const o = await p.evaluate(() => {
          const H = innerHeight, bad = [];
          document.querySelectorAll('#act [data-qi], #act [data-mt], #act [data-lab], #act [data-go], #act #spec-wrap, #act .eye-svg, #act #w-svg, #act .hud').forEach(el => { const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1 || r.height < 20) bad.push(`${el.dataset.qi != null ? 'option' : el.id || el.className.baseVal || el.className}:${Math.round(r.top)}-${Math.round(r.bottom)}/${H}`); });
          const ov = document.documentElement.scrollWidth > innerWidth;
          return { bad, ov };
        });
        if (o.bad.length || o.ov) probs.push(`${id}: ${o.bad.slice(0, 3).join(', ')}${o.ov ? ' 横スクロール' : ''}`);
        // advance one round with a correct-ish tap so later rounds (different layouts) get checked
        await p.evaluate(() => { const A = __T.cur; if (A && A.wait <= 0) { A.wait = 0.01; } });
        await p.waitForTimeout(250);
      }
      await p.click('#act-quit');
    }
    // quiz screens
    for (const m of ['mix', 'names', 'g:eye', 'g:vision', 'g:light']) {
      await p.click('#bottom-nav [data-tab="quiz"]');
      await p.click('#go-genres');
      await p.evaluate(mm => document.querySelector(`[data-mode="${mm}"]`).click(), m);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (ov) probs.push(`quiz ${m}: 横スクロール`);
      await p.click('#quit');
      await p.click('#bottom-nav [data-tab="play"]');
    }
    [...new Set(probs)].forEach(x => P('  NG ' + x));
    if (!probs.length) P('  問題なし');
    await p.close();
  }
  await b.close();
})();
