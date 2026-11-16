/* CPO Academy 앱: 라우팅, 화면, 로컬 저장, 동기화 연결 */
(function () {
  'use strict';
  const C = window.Core;
  const VERSION = '14';
  const GROUPS = [
    { name: '시작하기', tracks: ['start'] },
    { name: '우선 집중', tracks: ['ab', 'finance', 'econ', 'logic', 'decision'] },
    { name: '실무 문서 · 지표 · 도구', tracks: ['docs', 'metrics', 'order', 'tools', 'db', 'terms'] },
    { name: '전문 영역', tracks: ['data', 'growth', 'search', 'ads', 'zero', 'ai', 'ux'] },
    { name: '리더십과 운영', tracks: ['lead', 'pm', 'strategy', 'hbr'] },
    { name: '커리어', tracks: ['interview'] }
  ];
  const PUBLIC = GROUPS.flatMap(g => g.tracks);
  const HOW_TRACKS = ['ab', 'finance', 'econ', 'logic', 'decision']; // content/h/<트랙>.md 가 있는 트랙
  const PRIVATE_GROUP = { name: '나의 커리어 · 비공개', tracks: [] };
  GROUPS.unshift(PRIVATE_GROUP);
  const HUES = { ab: 222, finance: 158, econ: 28, logic: 262, decision: 344, data: 196, growth: 96, search: 210, ads: 12, zero: 46, ai: 280, ux: 322, lead: 176, pm: 240, strategy: 60, hbr: 4, docs: 250, metrics: 140, order: 20, tools: 190, db: 300, terms: 80, start: 226, interview: 330 };

  const $ = (s, el) => (el || document).querySelector(s);
  const main = $('#main');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  let tracks = {}, lessons = {}, quizzes = {}, flat = [];
  let publicTexts = {}, privTexts = store.get('cpo.priv', {});
  let extraTexts = {}, howTexts = {}, glossary = [], defs = [], howtos = [];
  /* 공개 콘텐츠와 비공개(Gist) 콘텐츠를 합쳐 커리큘럼을 구성 */
  function build() {
    tracks = {}; lessons = {}; quizzes = {}; flat = [];
    PRIVATE_GROUP.tracks = Object.keys(privTexts).sort();
    const add = (s, text) => {
      if (!text) return;
      const t = C.parseTrack(s, text); if (!t.lessons.length) return;
      tracks[s] = t; t.lessons.forEach(l => { lessons[l.id] = l; flat.push(l); l.quiz.forEach(q => { quizzes[q.id] = q; }); });
    };
    PUBLIC.forEach(s => add(s, publicTexts[s]));
    PRIVATE_GROUP.tracks.forEach(s => add('p-' + s, privTexts[s]));
    PRIVATE_GROUP.tracks = PRIVATE_GROUP.tracks.map(s => 'p-' + s);
    Object.keys(extraTexts).forEach(s => { if (extraTexts[s]) C.mergeExtras(lessons, extraTexts[s]); });
    Object.keys(howTexts).forEach(s => { if (howTexts[s]) C.mergeHows(lessons, howTexts[s]); });
    quizzes = {}; flat.forEach(l => l.quiz.forEach(q => { quizzes[q.id] = q; }));
  }
  let state = C.merge(store.get('cpo.state', null), null);
  let token = store.get('cpo.token', '');
  let gistId = store.get('cpo.gist', '');
  let syncStatus = token ? 'idle' : 'off', syncMsg = '', lastSync = store.get('cpo.lastSync', 0);
  let busy = false, queued = false, pushTimer = null;
  let dataKey = null; // 잠금을 풀면 생기는 데이터 키. 동기화 내용도 이 키로 암호화한다
  const mkApi = () => C.makeSync(window.fetch.bind(window), token, null, dataKey ? { enc: s => C.encText(dataKey, s), dec: s => C.decText(dataKey, s) } : null);

  /* ---------- 상태 변경 ---------- */
  function commit(touch) {
    if (touch !== false) { const k = C.dayKey(Date.now()); state.days[k] = (state.days[k] || 0) + 1; }
    state = C.canon(state);
    store.set('cpo.state', state);
    renderChrome();
    if (token) { clearTimeout(pushTimer); pushTimer = setTimeout(sync, 1500); }
  }

  /* ---------- 동기화 ---------- */
  function setSync(s, msg) { syncStatus = s; syncMsg = msg || ''; renderChrome(); const el = $('#sync-live'); if (el) el.innerHTML = syncLine(); }
  async function sync() {
    if (!token) return;
    if (busy) { queued = true; return; }
    busy = true; setSync('busy');
    const api = mkApi();
    try {
      if (!gistId) { gistId = await api.find() || await api.create(state); store.set('cpo.gist', gistId); }
      let got;
      try { got = await api.pull(gistId); }
      catch (e) { if (e.status !== 404) throw e; gistId = await api.find() || await api.create(state); store.set('cpo.gist', gistId); got = await api.pull(gistId); }
      const remote = got.state;
      const merged = C.merge(state, remote);
      let localChanged = !C.same(merged, state);
      if (Object.keys(got.priv).length && !C.same(got.priv, privTexts)) { privTexts = got.priv; store.set('cpo.priv', privTexts); build(); localChanged = true; }
      state = merged; store.set('cpo.state', state);
      if (!C.same(merged, remote) || got.plain.includes(C.FILE)) await api.push(gistId, merged);
      for (const name of got.plain) { const m = name.match(/^cpo-academy-private-?([\w]*)\.md$/); if (m) await api.putFile(gistId, name, got.priv[m[1] || 'me']); } // 암호화 전에 올린 파일을 암호화해 다시 올린다
      lastSync = Date.now(); store.set('cpo.lastSync', lastSync);
      setSync('ok');
      if (localChanged && !location.hash.startsWith('#l/')) route();
    } catch (e) {
      if (e.code === 'key') setSync('error', '동기화 데이터가 다른 암호로 잠겨 있어 열 수 없습니다.');
      else if (e.status === 401 || e.status === 403) setSync('error', '토큰이 거부되었습니다. 설정에서 토큰을 다시 넣어 주세요.');
      else setSync('error', navigator.onLine === false ? '오프라인입니다. 연결되면 자동으로 다시 맞춥니다.' : '동기화에 실패했습니다. 잠시 후 자동으로 다시 시도합니다.');
    } finally {
      busy = false;
      if (queued) { queued = false; sync(); }
    }
  }
  function syncLine() {
    const t = lastSync ? new Date(lastSync).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    if (syncStatus === 'off') return '<span class="dot off"></span>이 기기에만 저장 중';
    if (syncStatus === 'busy') return '<span class="dot busy"></span>동기화 중';
    if (syncStatus === 'error') return '<span class="dot err"></span>' + C.esc(syncMsg);
    return '<span class="dot ok"></span>동기화됨' + (t ? ' · ' + t : '');
  }

  /* ---------- 진도 계산 ---------- */
  const doneIn = slug => tracks[slug].lessons.filter(l => state.done[l.id]).length;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  function nextLesson() { return flat.find(l => !state.done[l.id]) || null; }
  function hue(slug) { return 'style="--h:' + (HUES[slug] || 220) + '"'; }

  /* ---------- 공통 틀 ---------- */
  function renderChrome() {
    if (!flat.length) return;
    const total = flat.length, done = flat.filter(l => state.done[l.id]).length;
    const due = C.dueIds(state, Date.now()).filter(id => quizzes[id]).length;
    const cur = location.hash.slice(1);
    const curTrack = cur.startsWith('t/') ? cur.slice(2) : (cur.startsWith('l/') && lessons[cur.slice(2)] ? lessons[cur.slice(2)].track : '');
    $('#side-body').innerHTML =
      '<div class="side-prog"><div class="bar"><i style="width:' + pct(done, total) + '%"></i></div><span>' + done + ' / ' + total + ' 레슨</span></div>' +
      '<a class="nav' + (cur === '' ? ' on' : '') + '" href="#">홈</a>' +
      '<a class="nav' + (cur === 'review' ? ' on' : '') + '" href="#review">복습' + (due ? '<b class="badge">' + due + '</b>' : '') + '</a>' +
      '<a class="nav' + (cur === 'all' ? ' on' : '') + '" href="#all">전체 검색</a>' +
      '<a class="nav' + (cur === 'settings' ? ' on' : '') + '" href="#settings">설정과 동기화</a>' +
      GROUPS.filter(g => g.tracks.some(s => tracks[s])).map(g => '<div class="grp">' + g.name + '</div>' + g.tracks.filter(s => tracks[s]).map(s => {
        const t = tracks[s], d = doneIn(s);
        return '<a class="trk' + (curTrack === s ? ' on' : '') + '" ' + hue(s) + ' href="#t/' + s + '"><i class="chip"></i><span>' + C.esc(t.title) + '</span><em>' + d + '/' + t.lessons.length + '</em></a>';
      }).join('')).join('') +
      '<div class="side-sync">' + syncLine() + '</div>';
    $('#tabs').innerHTML =
      tab('', '홈', cur === '') + tab('all', '커리큘럼', cur === 'all' || cur.startsWith('t/') || cur.startsWith('l/')) +
      tab('review', '복습' + (due ? ' ' + due : ''), cur === 'review') + tab('settings', '설정', cur === 'settings');
  }
  function tab(h, label, on) { return '<a href="#' + h + '"' + (on ? ' class="on"' : '') + '>' + label + '</a>'; }

  /* ---------- 홈 ---------- */
  function viewHome() {
    const total = flat.length, done = flat.filter(l => state.done[l.id]).length;
    const now = Date.now(), nx = nextLesson();
    const due = C.dueIds(state, now).filter(id => quizzes[id]).length;
    const qs = Object.keys(state.quiz).filter(k => quizzes[k]);
    const acc = qs.length ? pct(qs.filter(k => state.quiz[k].ok).length, qs.length) : null;
    const mins = flat.filter(l => !state.done[l.id]).reduce((s, l) => s + l.min, 0);
    let strip = '';
    for (let i = 13; i >= 0; i--) {
      const k = C.dayKey(now - i * C.DAY), n = state.days[k] || 0;
      strip += '<i title="' + k + '" class="d' + (n > 5 ? 3 : n > 2 ? 2 : n > 0 ? 1 : 0) + '"></i>';
    }
    main.innerHTML =
      '<header class="page-head"><p class="eyebrow">CPO Academy</p><h1>시니어 PM에서 CPO까지, 판단의 근거를 쌓는 과정</h1></header>' +
      '<section class="stats">' +
      stat(pct(done, total) + '%', '전체 진도', done + ' / ' + total + ' 레슨') +
      stat(C.streak(state, now) + '일', '연속 학습', '최근 14일<span class="strip">' + strip + '</span>') +
      stat(acc == null ? '–' : acc + '%', '퀴즈 정답률', qs.length ? qs.length + '문항 기준' : '아직 푼 문항 없음') +
      stat(Math.ceil(mins / 60) + '시간', '남은 학습량', '읽기 시간 기준') +
      '</section>' +
      '<section class="next">' +
      (nx ? '<a class="next-card" ' + hue(nx.track) + ' href="#l/' + nx.id + '"><span class="eyebrow">이어서 학습 · ' + C.esc(tracks[nx.track].title) + '</span><strong>' + C.esc(nx.title) + '</strong><span class="muted">' + C.esc(nx.summary) + ' · ' + nx.min + '분</span></a>'
        : '<div class="next-card"><strong>모든 레슨을 마쳤습니다</strong><span class="muted">복습으로 기억을 유지하세요.</span></div>') +
      '<a class="next-card alt" href="#review"><span class="eyebrow">간격 반복 복습</span><strong>' + (due ? '오늘 복습할 문항 ' + due + '개' : '오늘 복습할 문항이 없습니다') + '</strong><span class="muted">레슨에서 푼 퀴즈가 1·3·7·16·35일 간격으로 다시 나옵니다.</span></a>' +
      '</section>' +
      GROUPS.filter(g => g.tracks.some(s => tracks[s])).map(g => '<h2 class="sec">' + g.name + '</h2><div class="grid">' + g.tracks.filter(s => tracks[s]).map(trackCard).join('') + '</div>').join('');
  }
  function stat(big, label, sub) { return '<div class="stat"><b>' + big + '</b><span>' + label + '</span><small>' + sub + '</small></div>'; }
  function trackCard(s) {
    const t = tracks[s], d = doneIn(s), n = t.lessons.length;
    return '<a class="card" ' + hue(s) + ' href="#t/' + s + '"><i class="chip"></i><strong>' + C.esc(t.title) + '</strong><p>' + C.esc(t.desc) + '</p>' +
      '<div class="bar"><i style="width:' + pct(d, n) + '%"></i></div><small>' + d + ' / ' + n + ' 레슨</small></a>';
  }

  /* ---------- 트랙 / 전체 ---------- */
  function lessonRow(l, showTrack) {
    const d = state.done[l.id];
    return '<a class="row' + (d ? ' done' : '') + '" ' + hue(l.track) + ' href="#l/' + l.id + '"><i class="check">' + (d ? '✓' : '') + '</i><div><strong>' + C.esc(l.title) + '</strong><span>' +
      (showTrack ? C.esc(tracks[l.track].title) + ' · ' : '') + C.esc(l.summary) + '</span></div><em>' + l.min + '분</em></a>';
  }
  function viewTrack(slug) {
    const t = tracks[slug]; if (!t) return viewHome();
    const d = doneIn(slug);
    main.innerHTML = '<header class="page-head" ' + hue(slug) + '><p class="eyebrow"><a href="#">홈</a> / 트랙</p><h1>' + C.esc(t.title) + '</h1><p class="lede">' + C.esc(t.desc) + '</p>' +
      '<div class="bar wide"><i style="width:' + pct(d, t.lessons.length) + '%"></i></div><small class="muted">' + d + ' / ' + t.lessons.length + ' 레슨 완료</small></header>' +
      '<div class="rows">' + t.lessons.map(l => lessonRow(l)).join('') + '</div>';
  }
  function viewAll() {
    main.innerHTML = '<header class="page-head"><p class="eyebrow">커리큘럼</p><h1>전체 레슨</h1>' +
      '<input id="q" class="search" type="search" placeholder="키워드로 찾기 (예: 표본 크기, LTV, 2차 가격 경매)" autocomplete="off"></header><div id="results"></div>';
    const inp = $('#q'), res = $('#results');
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { res.innerHTML = GROUPS.map(g => g.tracks.filter(s => tracks[s]).map(s => '<h2 class="sec" ' + hue(s) + '><a href="#t/' + s + '">' + C.esc(tracks[s].title) + '</a></h2><div class="rows">' + tracks[s].lessons.map(l => lessonRow(l)).join('') + '</div>').join('')).join(''); return; }
      const hits = flat.filter(l => (l.title + ' ' + l.summary + ' ' + l.body.join(' ')).toLowerCase().includes(q));
      res.innerHTML = hits.length ? '<p class="muted">' + hits.length + '개 레슨</p><div class="rows">' + hits.map(l => lessonRow(l, true)).join('') + '</div>'
        : '<p class="empty">"' + C.esc(inp.value) + '"에 맞는 레슨이 없습니다. 더 짧은 키워드로 찾아보세요.</p>';
    };
    inp.addEventListener('input', draw); draw();
  }

  /* ---------- 퀴즈 블록 (레슨과 복습 공용): 객관식, 값 입력, 서술 ---------- */
  const TYPE_LABEL = { mc: '선택', num: '계산', text: '서술' };
  const isAdv = q => !!q.adv || q.type === 'text' || /^\[사례\]/.test(q.q);
  function quizHtml(q, n) {
    const head = '<p class="q"><span class="qtype">' + (q.ox ? 'O·X' : TYPE_LABEL[q.type || 'mc']) + '</span><b>Q' + (n || '') + '.</b> ' + C.inline(q.q) + '</p>';
    if (q.type === 'num') {
      return '<div class="quiz" data-q="' + q.id + '">' + head +
        '<div class="btns"><input class="search num-in" type="text" inputmode="decimal" placeholder="숫자만 입력' + (q.unit ? ' (' + C.esc(q.unit) + ')' : '') + '" autocomplete="off"><button type="button" class="ghost num-go">확인</button></div><div class="why" hidden></div></div>';
    }
    if (q.type === 'text') {
      const saved = state.notes['q:' + q.id] ? state.notes['q:' + q.id].t : '';
      return '<div class="quiz" data-q="' + q.id + '">' + head +
        '<textarea class="essay" rows="4" placeholder="먼저 직접 써 보세요. 쓴 뒤에 모범 답안과 비교합니다.">' + C.esc(saved) + '</textarea>' +
        '<div class="btns"><button type="button" class="ghost essay-show">모범 답안 보기</button></div>' +
        '<div class="why" hidden>' + explain(q) + '<div class="btns grade"><span class="muted">내 답은?</span><button type="button" class="ghost" data-g="1">요점을 다 담았다</button><button type="button" class="ghost" data-g="0">빠진 것이 있다</button></div></div></div>';
    }
    const order = q.opts.map((_, i) => i); if (!q.ox) order.sort(() => Math.random() - 0.5);
    return '<div class="quiz" data-q="' + q.id + '">' + head +
      order.map(i => '<button type="button" class="opt" data-i="' + i + '">' + C.inline(q.opts[i]) + '</button>').join('') +
      '<div class="why" hidden></div></div>';
  }
  /* 풀이 패널: 왜 이것이 답인가, 푸는 순서, 용어 설명 */
  function termsIn(text) {
    const out = []; let rest = text;
    const en = {}; glossary.forEach(g => { en[g[0]] = g[1]; });
    for (const [ko, def] of defs) {
      if (out.length >= 6) break;
      if (rest.indexOf(ko) < 0) continue;
      rest = rest.split(ko).join(' ');
      out.push('<dt>' + C.esc(ko) + (en[ko] ? ' <small>' + C.esc(en[ko]) + '</small>' : '') + '</dt><dd>' + C.inline(def) + '</dd>');
    }
    return out.join('');
  }
  /* 풀이에 나온 방법(무작위 배정, 이중차분 등)을 실무에서 어떻게 하는지 찾아 붙인다 */
  function howtosFor(q) {
    const ans = q.type === 'mc' ? q.opts[q.ans] : '';
    const layers = [ans + ' ' + q.why, q.how || '', q.q];
    const found = [];
    howtos.forEach((h, i) => {
      let rank = -1, pos = 0;
      for (let r = 0; r < layers.length && rank < 0; r++) {
        for (const k of h.keys) { const at = layers[r].indexOf(k); if (at >= 0) { rank = r; pos = at; break; } }
      }
      if (rank >= 0) found.push({ h, rank, pos, i });
    });
    found.sort((a, b) => a.rank - b.rank || a.pos - b.pos || a.i - b.i);
    return found.slice(0, 2).map((f, n) =>
      '<details class="howto"' + (n === 0 ? ' open' : '') + '><summary>' + C.esc(f.h.title) + '</summary><ol>' +
      f.h.steps.map(x => '<li>' + C.inline(x) + '</li>').join('') + '</ol>' +
      (f.h.note ? '<p class="howto-note">' + C.inline(f.h.note) + '</p>' : '') + '</details>').join('');
  }
  function explain(q) {
    const steps = s => s.split(' / ').map(x => '<li>' + C.inline(x) + '</li>').join('');
    const ans = q.type === 'mc' ? q.opts[q.ans] : '';
    const terms = termsIn([q.q, ans, q.why, q.how || ''].join(' '));
    const practice = howtosFor(q);
    return '<div class="ex">' +
      (q.type === 'text'
        ? '<h4>모범 답안의 요점</h4><ul>' + steps(q.why) + '</ul>'
        : '<h4>왜 이것이 답인가</h4><p>' + C.inline(q.why) + '</p>') +
      (q.how ? '<h4>' + (q.type === 'text' ? '답을 쓰는 순서' : '푸는 순서') + '</h4><ol>' + steps(q.how) + '</ol>' : '') +
      (practice ? '<h4>실무에서는 이렇게 합니다</h4>' + practice : '') +
      (terms ? '<h4>용어</h4><dl>' + terms + '</dl>' : '') + '</div>';
  }
  function bindQuiz(el, after) {
    const record = (q, ok, box) => { state.quiz[q.id] = C.schedule(state.quiz[q.id], ok, Date.now()); commit(); if (after) after(ok, box); };
    el.addEventListener('click', e => {
      const box = e.target.closest('.quiz'); if (!box) return;
      const q = quizzes[box.dataset.q]; if (!q) return;
      const why = $('.why', box);
      if (e.target.closest('.num-go')) {
        if (box.dataset.answered) return;
        const inp = $('.num-in', box), v = parseFloat(String(inp.value).replace(/[,\s%원명건]/g, ''));
        if (isNaN(v)) { inp.focus(); return; }
        const ok = Math.abs(v - q.ans) <= q.tol + 1e-9;
        box.dataset.answered = '1'; inp.disabled = true; inp.classList.add(ok ? 'right' : 'wrong');
        why.hidden = false;
        why.innerHTML = '<p class="verdict ' + (ok ? 'ok' : 'no') + '"><b>' + (ok ? '정답입니다.' : '오답입니다.') + '</b> 정답: ' + q.ans.toLocaleString('ko-KR') + (q.unit ? ' ' + C.esc(q.unit) : '') + '</p>' + explain(q);
        record(q, ok, box); return;
      }
      if (e.target.closest('.essay-show')) { why.hidden = false; e.target.closest('.btns').hidden = true; return; }
      const g = e.target.closest('[data-g]');
      if (g) {
        if (box.dataset.answered) return;
        box.dataset.answered = '1'; g.classList.add(g.dataset.g === '1' ? 'right' : 'wrong');
        box.querySelectorAll('[data-g]').forEach(b => { b.disabled = true; });
        record(q, g.dataset.g === '1', box); return;
      }
      const b = e.target.closest('.opt'); if (!b || box.dataset.answered) return;
      const ok = +b.dataset.i === q.ans;
      box.dataset.answered = '1';
      box.querySelectorAll('.opt').forEach(o => { o.disabled = true; if (+o.dataset.i === q.ans) o.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      why.hidden = false;
      why.innerHTML = '<p class="verdict ' + (ok ? 'ok' : 'no') + '"><b>' + (ok ? '정답입니다.' : '오답입니다.') + '</b> 정답: ' + C.inline(q.opts[q.ans]) + '</p>' + explain(q);
      record(q, ok, box);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('num-in')) { e.preventDefault(); const go = e.target.closest('.quiz').querySelector('.num-go'); if (go) go.click(); } });
    let et;
    el.addEventListener('input', e => {
      const t = e.target;
      if (t.classList.contains('essay')) { const id = 'q:' + t.closest('.quiz').dataset.q, v = t.value; clearTimeout(et); et = setTimeout(() => { state.notes[id] = { t: v, ts: Date.now() }; commit(false); }, 800); }
      if (t.classList.contains('act-note')) { const id = t.dataset.a, v = t.value; clearTimeout(et); et = setTimeout(() => { state.notes[id] = { t: v, ts: Date.now() }; commit(false); }, 800); }
    });
    el.addEventListener('change', e => {
      const t = e.target; if (!t.classList.contains('act-done')) return;
      if (t.checked) state.mission[t.dataset.a] = Date.now(); else delete state.mission[t.dataset.a];
      commit(t.checked);
      const c = t.closest('.action'); if (c) c.classList.toggle('is-done', t.checked);
    });
  }

  /* 용어 영어 병기: 레슨마다 각 용어의 첫 등장에 영어를 붙인다 */
  function annotate(root) {
    if (!glossary.length || !root) return;
    const used = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('pre, code, .term, th, h3') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      let text = node.nodeValue, parts = null;
      for (const [ko, en] of glossary) {
        if (used.has(ko)) continue;
        const src = parts ? parts[parts.length - 1] : text;
        if (typeof src !== 'string') continue;
        const k = src.indexOf(ko); if (k < 0) continue;
        if (src.slice(k + ko.length, k + ko.length + 2).match(/^\s?\(/)) { used.add(ko); continue; } // 이미 괄호 병기됨
        used.add(ko);
        const span = document.createElement('span'); span.className = 'term'; span.textContent = ko;
        const sm = document.createElement('small'); sm.textContent = en; span.appendChild(sm);
        parts = (parts ? parts.slice(0, -1) : []).concat([src.slice(0, k), span, src.slice(k + ko.length)]);
      }
      if (parts) { const frag = document.createDocumentFragment(); parts.forEach(p => frag.appendChild(typeof p === 'string' ? document.createTextNode(p) : p)); node.parentNode.replaceChild(frag, node); }
    }
  }

  /* ---------- 레슨 ---------- */
  function actionHtml(a, n) {
    const note = state.notes[a.id] ? state.notes[a.id].t : '', done = !!state.mission[a.id];
    const steps = a.how ? a.how.split(' / ').filter(Boolean) : [];
    return '<div class="action' + (done ? ' is-done' : '') + '"><h3><span class="anum">' + n + '</span>' + C.inline(a.title) + '</h3>' +
      (a.why ? '<p class="arow"><b>왜 해 보는가</b>' + C.inline(a.why) + '</p>' : '') +
      (steps.length ? '<div class="arow"><b>이렇게 해 보세요</b><ol>' + steps.map(x => '<li>' + C.inline(x) + '</li>').join('') + '</ol></div>' : '') +
      (a.out ? '<p class="arow"><b>하고 나면 남는 것</b>' + C.inline(a.out) + '</p>' : '') +
      '<textarea class="act-note" data-a="' + a.id + '" rows="3" placeholder="실행 결과 기록: 무엇을 했고, 어떤 숫자나 반응이 나왔고, 무엇을 배웠는지">' + C.esc(note) + '</textarea>' +
      '<label class="tick"><input type="checkbox" class="act-done" data-a="' + a.id + '"' + (done ? ' checked' : '') + '> 해 봤습니다</label></div>';
  }
  function lessonActions(l) {
    const list = l.actions.slice();
    if (l.mission) list.push({ id: l.id, title: l.mission, why: '', how: '', out: '' });
    return list;
  }
  function viewLesson(id) {
    const l = lessons[id]; if (!l) return viewHome();
    const t = tracks[l.track], idx = t.lessons.indexOf(l), fi = flat.indexOf(l);
    const prev = flat[fi - 1], next = flat[fi + 1], acts = lessonActions(l);
    const basic = l.quiz.filter(q => !isAdv(q)), adv = l.quiz.filter(isAdv);
    main.innerHTML = '<article class="lesson" ' + hue(l.track) + '>' +
      '<header class="page-head"><p class="eyebrow"><a href="#t/' + l.track + '">' + C.esc(t.title) + '</a> · ' + (idx + 1) + ' / ' + t.lessons.length + ' · ' + l.min + '분</p><h1>' + C.esc(l.title) + '</h1><p class="lede">' + C.esc(l.summary) + '</p>' +
      '<p class="muted">기본 문제 ' + basic.length + '개 · 심화 문제 ' + adv.length + '개 · 실행 예시 ' + acts.length + '개</p></header>' +
      '<div class="prose">' + C.md(l.body) + '</div>' +
      (basic.length ? '<section class="block"><h2>기본 문제 <span class="count">' + basic.length + '</span></h2><p class="muted">개념을 정확히 이해했는지 확인합니다. 답을 고르면 풀이가 나오고, 푼 문제는 복습 일정에 자동으로 들어갑니다.</p>' + basic.map((q, i) => quizHtml(q, i + 1)).join('') + '</section>' : '') +
      (adv.length ? '<section class="block"><h2>심화 문제 <span class="count">' + adv.length + '</span></h2><p class="muted">실제 상황에 적용하는 사례, 계산, 서술 문제입니다. 서술 문제는 먼저 직접 쓴 뒤 풀이와 비교하세요.</p>' + adv.map((q, i) => quizHtml(q, i + 1)).join('') + '</section>' : '') +
      (acts.length ? '<section class="block"><h2>실행 예시 <span class="count">' + acts.length + '</span></h2><p class="muted">읽은 것을 실제로 해 보는 구체적인 방법입니다. 하나를 골라 실행하고 결과를 기록하세요. 기록은 다른 기기에서도 보입니다.</p>' + acts.map((a, i) => actionHtml(a, i + 1)).join('') + '</section>' : '') +
      '<section class="block"><button type="button" class="ghost" id="copy">이 레슨으로 AI와 심화 토론할 프롬프트 복사</button><span id="copied" class="muted" hidden> 복사했습니다</span></section>' +
      '<footer class="lesson-foot"><button type="button" class="primary" id="done"></button>' +
      '<div class="pn">' + (prev ? '<a href="#l/' + prev.id + '">← ' + C.esc(prev.title) + '</a>' : '<span></span>') + (next ? '<a href="#l/' + next.id + '">' + C.esc(next.title) + ' →</a>' : '') + '</div></footer></article>';
    annotate($('.prose', main));
    const btn = $('#done');
    const paint = () => { btn.textContent = state.done[id] ? '완료함 · 다시 표시 해제' : '학습 완료로 표시'; btn.classList.toggle('is-done', !!state.done[id]); };
    paint();
    btn.onclick = () => {
      if (state.done[id]) { delete state.done[id]; commit(false); paint(); }
      else { state.done[id] = Date.now(); commit(); paint(); if (next) location.hash = 'l/' + next.id; }
    };
    $('#copy').onclick = async () => {
      const text = '나는 배달 플랫폼의 시니어 PM이고 CPO를 목표로 공부하고 있어. 주제: "' + t.title + ' / ' + l.title + '". ' +
        '1) 이 주제를 내가 정확히 이해했는지 어려운 질문 5개로 한 번에 하나씩 검증해 줘. 2) 내 답의 논리적 빈틈을 지적해 줘. 3) 배달·커머스 플랫폼의 실제 의사결정 상황으로 케이스를 하나 내 줘.' +
        (acts.length ? ' 참고로 내가 해 볼 실행 과제: ' + acts.map(a => a.title).join('; ') : '');
      try { await navigator.clipboard.writeText(text); } catch (e) { window.prompt('아래 문장을 복사하세요', text); }
      $('#copied').hidden = false;
    };
  }

  /* ---------- 복습 ---------- */
  function viewReview() {
    const ids = C.dueIds(state, Date.now()).filter(id => quizzes[id]);
    const answered = Object.keys(state.quiz).filter(k => quizzes[k]).length;
    if (!ids.length) {
      main.innerHTML = '<header class="page-head"><p class="eyebrow">간격 반복</p><h1>복습</h1></header><p class="empty">' +
        (answered ? '지금 복습할 문항이 없습니다. 다음 문항은 예정된 날짜에 다시 나타납니다.' : '아직 복습할 문항이 없습니다. 레슨의 확인 문제를 풀면 여기에 자동으로 쌓입니다.') +
        '</p><a class="primary as-link" href="#' + (nextLesson() ? 'l/' + nextLesson().id : '') + '">레슨 이어서 학습</a>';
      return;
    }
    let i = 0, right = 0;
    const show = () => {
      if (i >= ids.length) { main.innerHTML = '<header class="page-head"><p class="eyebrow">간격 반복</p><h1>복습 완료</h1></header><p class="empty">' + ids.length + '문항 중 ' + right + '문항을 맞혔습니다. 틀린 문항은 10분 뒤 다시 나옵니다.</p><a class="primary as-link" href="#">홈으로</a>'; renderChrome(); return; }
      const q = quizzes[ids[i]], l = lessons[q.lesson];
      main.innerHTML = '<header class="page-head"><p class="eyebrow">간격 반복 · ' + (i + 1) + ' / ' + ids.length + '</p><h1>복습</h1></header>' +
        '<div ' + hue(l.track) + '>' + quizHtml(q) + '</div><p class="muted">출처: <a href="#l/' + l.id + '">' + C.esc(l.title) + '</a></p><button type="button" class="primary" id="nx" hidden>다음 문항</button>';
      $('#nx').onclick = () => { i++; show(); };
    };
    show();
    reviewAfter =ok => { if (ok) right++; const b = $('#nx'); if (b) b.hidden = false; };
  }
  let reviewAfter = null;

  /* ---------- 설정 ---------- */
  /* ---------- 알림: 캘린더 반복 알림(.ics, Google 캘린더)과 브라우저 알림 ---------- */
  const SITE = location.origin + location.pathname;
  let ncfg = Object.assign({ on: false, lesson: '08:00', review: '21:00', last: {} }, store.get('cpo.notify', {}));
  const saveN = () => store.set('cpo.notify', ncfg);
  const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;
  const pad = n => String(n).padStart(2, '0');
  function stamp(hm, addMin) {
    const d = new Date(), p = hm.split(':'); d.setHours(+p[0], +p[1] + (addMin || 0), 0, 0);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  }
  const KINDS = {
    lesson: { title: 'CPO Academy 오늘의 레슨', body: '이어서 학습할 레슨을 엽니다.', url: SITE },
    review: { title: 'CPO Academy 복습', body: '오늘 복습할 문항을 풉니다.', url: SITE + '#review' }
  };
  function icsText() {
    const ev = k => ['BEGIN:VEVENT', 'UID:cpo-academy-' + k + '@cpo-academy', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + stamp(ncfg[k]), 'DURATION:PT15M', 'RRULE:FREQ=DAILY', 'SUMMARY:' + KINDS[k].title, 'DESCRIPTION:' + KINDS[k].body + ' ' + KINDS[k].url, 'URL:' + KINDS[k].url,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + KINDS[k].title, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CPO Academy//KO', 'CALSCALE:GREGORIAN', ev('lesson'), ev('review'), 'END:VCALENDAR'].join('\r\n');
  }
  function gcalUrl(k) {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(KINDS[k].title) + '&dates=' + stamp(ncfg[k]) + '/' + stamp(ncfg[k], 15) +
      '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY') + '&details=' + encodeURIComponent(KINDS[k].body + ' ' + KINDS[k].url) + (tz ? '&ctz=' + encodeURIComponent(tz) : '');
  }
  function notifyState() {
    if (!canNotify()) return '이 브라우저는 알림을 지원하지 않습니다. 캘린더 알림을 쓰세요.';
    if (Notification.permission === 'denied') return '이 브라우저에서 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 허용으로 바꿔야 합니다.';
    return ncfg.on && Notification.permission === 'granted' ? '이 브라우저의 알림이 켜져 있습니다.' : '이 브라우저의 알림이 꺼져 있습니다.';
  }
  function notifyHtml() {
    return '<section class="block"><h2>학습 알림</h2><p>레슨과 복습 시간을 정해 두면 알림을 받을 수 있습니다.</p>' +
      '<div class="times"><label>레슨 알림 <input type="time" id="nt-lesson" value="' + ncfg.lesson + '"></label><label>복습 알림 <input type="time" id="nt-review" value="' + ncfg.review + '"></label></div>' +
      '<h3>캘린더 알림 <small class="muted">사이트를 닫아 두어도 매일 울립니다</small></h3>' +
      '<div class="btns"><button type="button" class="primary" id="nt-ics">캘린더 파일 받기 (.ics)</button><a class="ghost btn" id="nt-g-lesson" target="_blank" rel="noopener" href="' + gcalUrl('lesson') + '">Google 캘린더에 레슨 알림</a><a class="ghost btn" id="nt-g-review" target="_blank" rel="noopener" href="' + gcalUrl('review') + '">Google 캘린더에 복습 알림</a></div>' +
      '<p class="muted">매일 반복되는 일정 두 개가 만들어지고, 알림을 누르면 이 사이트가 열립니다. 휴대폰 캘린더와 연결된 계정에 추가하면 휴대폰에서도 울립니다. 시간을 바꾸면 캘린더에서 기존 일정을 지우고 다시 추가하세요.</p>' +
      '<h3>이 브라우저의 알림 <small class="muted">사이트가 열려 있을 때</small></h3>' +
      '<div class="btns"><button type="button" class="ghost" id="nt-on">' + (ncfg.on ? '알림 끄기' : '알림 켜기') + '</button><button type="button" class="ghost" id="nt-test"' + (ncfg.on ? '' : ' hidden') + '>시험 알림 보내기</button></div>' +
      '<p id="nt-note" class="muted">' + notifyState() + ' 정한 시간이 지난 뒤 사이트가 열려 있으면, 그날 학습하지 않았을 때는 다음 레슨을, 복습할 문항이 있을 때는 그 개수를 알려 줍니다. 사이트를 닫아 둔 동안에는 뜨지 않습니다.</p></section>';
  }
  async function showNote(k, body) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(KINDS[k].title, { body, tag: 'cpo-' + k, icon: 'icon.svg', data: { url: KINDS[k].url } });
      return true;
    } catch (e) { return false; }
  }
  function badge() {
    try {
      const n = C.dueIds(state, Date.now()).filter(id => quizzes[id]).length;
      if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); }
    } catch (e) { }
  }
  async function notifyTick() {
    badge();
    if (!ncfg.on || !canNotify() || Notification.permission !== 'granted' || !flat.length) return;
    const now = new Date(), today = C.dayKey(now.getTime()), hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    for (const k of ['lesson', 'review']) {
      if (ncfg.last[k] === today || hm < ncfg[k]) continue;
      let body = '';
      if (k === 'lesson') { const nx = nextLesson(); if (nx && !state.days[today]) body = '다음 레슨: ' + nx.title + ' (' + nx.min + '분)'; }
      else { const n = C.dueIds(state, now.getTime()).filter(id => quizzes[id]).length; if (n) body = '오늘 복습할 문항이 ' + n + '개 있습니다.'; }
      ncfg.last[k] = today; saveN();
      if (body) await showNote(k, body);
    }
  }
  function bindNotify(on) {
    const refresh = () => { ncfg.lesson = $('#nt-lesson').value || ncfg.lesson; ncfg.review = $('#nt-review').value || ncfg.review; ncfg.last = {}; saveN(); $('#nt-g-lesson').href = gcalUrl('lesson'); $('#nt-g-review').href = gcalUrl('review'); };
    ['nt-lesson', 'nt-review'].forEach(id => { const el = $('#' + id); if (el) el.onchange = refresh; });
    on('nt-ics', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([icsText()], { type: 'text/calendar;charset=utf-8' })); a.download = 'cpo-academy-alarm.ics';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    on('nt-on', async () => {
      if (ncfg.on) { ncfg.on = false; saveN(); viewSettings(); return; }
      if (!canNotify()) { $('#nt-note').textContent = notifyState(); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { $('#nt-note').textContent = notifyState(); return; }
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { $('#nt-note').textContent = '알림을 준비하지 못했습니다. 캘린더 알림을 쓰세요.'; return; }
      ncfg.on = true; ncfg.last = {}; saveN(); viewSettings(); notifyTick();
    });
    on('nt-test', async () => { const ok = await showNote('review', '시험 알림입니다. 누르면 복습 화면이 열립니다.'); if (!ok) $('#nt-note').textContent = '알림을 보내지 못했습니다. 브라우저의 알림 설정을 확인하세요.'; });
  }

  function viewSettings() {
    main.innerHTML = '<header class="page-head"><p class="eyebrow">설정</p><h1>알림, 동기화, 데이터</h1></header>' + notifyHtml() +
      '<section class="block"><h2>기기 간 동기화</h2><p id="sync-live" class="sync-line">' + syncLine() + '</p>' +
      (token
        ? '<p>이 기기는 연결되어 있습니다. 진도, 퀴즈 기록, 메모가 내 GitHub 계정의 비공개 Gist에 암호화되어 저장됩니다. 같은 Gist에 있는 비공개 트랙(나의 커리어)도 이 기기에서만 열립니다.</p>' +
        '<div class="btns"><button type="button" class="primary" id="sync-now">지금 동기화</button><button type="button" class="ghost" id="link">다른 기기 연결 링크 복사</button><button type="button" class="ghost" id="unlink">이 기기 연결 해제</button></div><p id="link-note" class="muted" hidden>링크를 복사했습니다. 이 링크에는 토큰이 들어 있으니 본인 기기에서만 여세요.</p>'
        : '<ol class="steps"><li><a href="https://github.com/settings/tokens/new?scopes=gist&description=CPO%20Academy%20sync" target="_blank" rel="noopener">GitHub 토큰 만들기 페이지</a>를 엽니다. 권한은 <code>gist</code> 하나만 체크되어 있습니다.</li><li>만료 기간을 고르고 토큰을 생성한 뒤 복사합니다.</li><li>아래에 붙여 넣고 연결합니다. 두 번째 기기부터는 "다른 기기 연결 링크"를 열기만 하면 됩니다.</li></ol>' +
        '<div class="btns"><input id="tok" type="password" class="search" placeholder="ghp_로 시작하는 토큰" autocomplete="off"><button type="button" class="primary" id="connect">연결</button></div><p class="muted">토큰은 이 브라우저에만 저장되며 GitHub 외에는 어디로도 전송되지 않습니다.</p>') +
      '</section>' +
      '<section class="block"><h2>비공개 트랙</h2><p>경력, 인터뷰 준비처럼 공개하면 안 되는 내용은 사이트가 아니라 내 기기와 내 비공개 Gist에만, 암호화된 상태로 저장됩니다. <code>cpo-academy-private.md</code> 형식의 파일을 선택하면 "나의 커리어" 트랙으로 추가됩니다.</p>' +
      '<div class="btns"><input type="file" id="priv-file" accept=".md,.txt,text/markdown,text/plain"><button type="button" class="ghost" id="priv-del"' + (Object.keys(privTexts).length ? '' : ' hidden') + '>비공개 트랙 지우기</button></div><p id="priv-note" class="muted">' +
      (Object.keys(privTexts).length ? '현재 비공개 트랙 ' + Object.keys(privTexts).length + '개가 이 기기에 있습니다.' + (token ? ' 연결된 다른 기기에도 동기화됩니다.' : ' 동기화를 연결하면 다른 기기에서도 열립니다.') : '아직 비공개 트랙이 없습니다.') + '</p></section>' +
      (dataKey ? '<section class="block"><h2>잠금</h2><p>이 사이트의 모든 내용은 암호화되어 있고, 이 기기는 암호를 기억하고 있습니다. 기기를 다른 사람에게 넘기거나 공용 기기라면 잠그세요. 진도는 지워지지 않습니다.</p><div class="btns"><button type="button" class="ghost" id="lock">이 기기 잠그기</button></div></section>' : '') +
      '<section class="block"><h2>백업</h2><div class="btns"><button type="button" class="ghost" id="exp">진도 내보내기 (복사)</button><button type="button" class="ghost" id="imp">가져오기</button></div>' +
      '<textarea id="io" rows="3" placeholder="가져올 때는 내보낸 텍스트를 여기에 붙여 넣고 가져오기를 누르세요." hidden></textarea><p id="io-note" class="muted" hidden></p></section>' +
      '<section class="block"><h2>초기화</h2><p>모든 기기의 진도, 퀴즈 기록, 메모를 지웁니다. 되돌릴 수 없습니다.</p><div class="btns"><button type="button" class="danger" id="reset">전체 초기화</button><button type="button" class="danger" id="reset-yes" hidden>정말 지웁니다</button></div></section>';
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    bindNotify(on);
    on('connect', () => { const v = $('#tok').value.trim(); if (!v) return; token = v; store.set('cpo.token', token); gistId = ''; store.del('cpo.gist'); syncStatus = 'idle'; viewSettings(); sync(); });
    on('sync-now', sync);
    on('lock', () => { store.del('cpo.key'); location.hash = ''; location.reload(); });
    on('unlink', () => { token = ''; gistId = ''; store.del('cpo.token'); store.del('cpo.gist'); store.del('cpo.priv'); privTexts = {}; build(); syncStatus = 'off'; viewSettings(); renderChrome(); });
    on('link', async () => {
      const url = location.origin + location.pathname + '#sync=' + encodeURIComponent(token);
      try { await navigator.clipboard.writeText(url); } catch (e) { window.prompt('아래 링크를 복사하세요', url); }
      $('#link-note').hidden = false;
    });
    const pf = $('#priv-file');
    if (pf) pf.onchange = async () => {
      const f = pf.files[0], n = $('#priv-note'); if (!f) return;
      const text = await f.text();
      if (!C.parseTrack('x', text).lessons.length) { n.textContent = '트랙 형식이 아닙니다. "## [id] 제목"으로 시작하는 레슨이 있어야 합니다.'; return; }
      const m = f.name.match(/^cpo-academy-private-?([\w]*)\.(md|txt)$/); const key = (m && m[1]) || 'me';
      privTexts = Object.assign({}, privTexts, { [key]: text }); store.set('cpo.priv', privTexts); build(); renderChrome();
      n.textContent = '추가했습니다.';
      if (token) {
        try {
          const api = mkApi();
          if (!gistId) { gistId = await api.find() || await api.create(state); store.set('cpo.gist', gistId); }
          await api.putFile(gistId, 'cpo-academy-private' + (key === 'me' ? '' : '-' + key) + '.md', text);
          n.textContent = '추가했고 내 비공개 Gist에도 저장했습니다. 연결된 다른 기기에서 자동으로 열립니다.';
        } catch (e) { n.textContent = '이 기기에는 추가했지만 Gist 저장에 실패했습니다. 잠시 후 다시 올려 주세요.'; }
      } else n.textContent = '이 기기에 추가했습니다. 동기화를 연결한 뒤 다시 올리면 다른 기기에서도 열립니다.';
      viewSettings();
    };
    on('priv-del', async () => {
      const keys = Object.keys(privTexts); privTexts = {}; store.del('cpo.priv'); build(); renderChrome();
      if (token && gistId) { const api = mkApi(); for (const k of keys) { try { await api.putFile(gistId, 'cpo-academy-private' + (k === 'me' ? '' : '-' + k) + '.md', null); } catch (e) { } } }
      viewSettings();
    });
    on('exp', async () => { const io = $('#io'); io.hidden = false; io.value = JSON.stringify(state); io.select(); try { await navigator.clipboard.writeText(io.value); } catch (e) { } const n = $('#io-note'); n.hidden = false; n.textContent = '내보냈습니다. 텍스트를 안전한 곳에 보관하세요.'; });
    on('imp', () => {
      const io = $('#io'), n = $('#io-note'); if (io.hidden || !io.value.trim()) { io.hidden = false; io.value = ''; io.focus(); return; }
      n.hidden = false;
      try { state = C.merge(state, JSON.parse(io.value)); commit(false); n.textContent = '가져와서 현재 진도와 합쳤습니다.'; }
      catch (e) { n.textContent = '형식이 맞지 않습니다. 내보내기로 복사한 텍스트 전체를 붙여 넣어 주세요.'; }
    });
    on('reset', () => { $('#reset-yes').hidden = false; });
    on('reset-yes', () => { state = C.emptyState(); state.resetAt = Date.now(); commit(false); viewSettings(); });
  }

  /* ---------- 라우터 ---------- */
  function route() {
    const h = location.hash.slice(1);
    reviewAfter = null;
    if (h.startsWith('l/')) viewLesson(h.slice(2));
    else if (h.startsWith('t/')) viewTrack(h.slice(2));
    else if (h === 'all') viewAll();
    else if (h === 'review') { viewReview(); }
    else if (h === 'settings') viewSettings();
    else viewHome();
    renderChrome();
    window.scrollTo(0, 0);
  }
  // 퀴즈 클릭은 문서 수준에서 한 번만 연결 (레슨과 복습 공용)
  bindQuiz(document.body, (ok, box) => { if (reviewAfter) reviewAfter(ok, box); });

  /* ---------- 잠금 ---------- */
  /* 암호를 받아 데이터 키를 돌려준다. 맞을 때까지 화면에 머문다 */
  function askPass(lock, note) {
    return new Promise(res => {
      document.body.classList.add('locked');
      main.innerHTML = '<form class="lock" id="lock-form"><span class="mark">C</span><h1>잠겨 있습니다</h1><p class="muted">암호를 입력하면 이 기기에서 계속 열립니다.</p>' +
        '<input id="pass" type="password" class="search" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="암호" aria-label="암호">' +
        '<button type="submit" class="primary" id="unlock">열기</button><p id="lock-note" class="muted" role="status">' + (note || '') + '</p></form>';
      const form = $('#lock-form'), inp = $('#pass'), n = $('#lock-note'), btn = $('#unlock');
      inp.focus();
      form.onsubmit = async ev => {
        ev.preventDefault(); if (!inp.value.trim() || btn.disabled) return;
        btn.disabled = true; n.textContent = '확인하는 중입니다.';
        try { const raw = await C.unwrapKey(inp.value, lock); res(raw); }
        catch (e) { btn.disabled = false; n.textContent = '암호가 맞지 않습니다.'; inp.select(); }
      };
    });
  }
  /* 암호화된 묶음(data.bin)을 풀어 {경로: 내용}으로 돌려준다. lock.json 이 없으면(로컬 원본) null */
  async function loadBundle() {
    const lock = await fetch('lock.json?v=' + VERSION, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!lock) return null;
    if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') throw new Error('unsupported');
    const r = await fetch('data.bin?v=' + VERSION, { cache: 'no-cache' }); if (!r.ok) throw new Error('net');
    const buf = new Uint8Array(await r.arrayBuffer());
    let raw = store.get('cpo.key', ''), note = '';
    for (;;) {
      if (!raw) raw = await askPass(lock, note);
      try {
        const key = await C.importKey(C.unb64(raw));
        const files = JSON.parse(new TextDecoder().decode(await C.gunzip(await C.decryptBytes(key, buf))));
        dataKey = key; store.set('cpo.key', raw); document.body.classList.remove('locked');
        return files;
      } catch (e) { store.del('cpo.key'); raw = ''; note = '내용이 새 키로 다시 잠겼습니다. 암호를 한 번 더 입력해 주세요.'; }
    }
  }

  /* ---------- 시작 ---------- */
  async function boot() {
    const m = location.hash.match(/^#sync=(.+)$/);
    if (m) { token = decodeURIComponent(m[1]); store.set('cpo.token', token); gistId = ''; store.del('cpo.gist'); syncStatus = 'idle'; history.replaceState(null, '', location.pathname + '#settings'); }
    main.innerHTML = '<p class="empty">커리큘럼을 불러오는 중입니다.</p>';
    try {
      const bundle = await loadBundle();
      main.innerHTML = '<p class="empty">커리큘럼을 불러오는 중입니다.</p>';
      const get = p => bundle ? Promise.resolve(bundle[p] || '') : fetch(p + '?v=' + VERSION, { cache: 'no-cache' }).then(r => r.ok ? r.text() : '').catch(() => '');
      const texts = await Promise.all(PUBLIC.map(s => get('content/' + s + '.md')));
      PUBLIC.forEach((s, i) => { publicTexts[s] = texts[i]; });
      const ex = await Promise.all(PUBLIC.map(s => get('content/x/' + s + '.md')));
      PUBLIC.forEach((s, i) => { extraTexts[s] = ex[i]; });
      glossary = C.parseGlossary(await get('content/glossary.txt'));
      defs = C.parseGlossary(await get('content/defs.txt'));
      howtos = C.parseHowto(await get('content/howto.txt'));
      const hw = await Promise.all(HOW_TRACKS.map(s => get('content/h/' + s + '.md')));
      HOW_TRACKS.forEach((s, i) => { howTexts[s] = hw[i]; });
      build();
      if (!flat.length) throw new Error('empty');
    } catch (e) {
      main.innerHTML = '<p class="empty">' + (e.message === 'unsupported' ? '이 브라우저에서는 잠금을 풀 수 없습니다. 최신 Safari나 Chrome에서 열어 주세요.' : '커리큘럼을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.') + '</p>'; return;
    }
    route();
    window.addEventListener('hashchange', route);
    if (token) sync();
    if (ncfg.on && canNotify()) navigator.serviceWorker.register('sw.js').catch(() => { });
    notifyTick(); setInterval(notifyTick, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) notifyTick(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && token) sync(); });
    window.addEventListener('online', () => { if (token) sync(); });
  }
  boot();
})();
