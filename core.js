/* 순수 로직: 콘텐츠 파서, 상태 병합, 복습 스케줄, Gist 동기화. 브라우저와 Node 양쪽에서 동작. */
(function (root) {
  'use strict';

  /* ---------- 콘텐츠 파서 ---------- */
  /* 한 줄을 현재 레슨에 반영. 문항(객관식 ??, 값 입력 ?#, 서술 ?~), 실행 예시(>>), 과제(!!), 본문 */
  function feed(cur, st, line) {
    const newQ = (type, text) => { st.q = { id: cur.id + ':' + cur.quiz.length, lesson: cur.id, type, q: text.trim(), opts: [], ans: -1, why: '' }; cur.quiz.push(st.q); st.last = st.q; st.a = null; };
    if (line.startsWith(':: ')) { const p = line.slice(3).split('|').map(x => x.trim()); cur.min = parseInt(p[0], 10) || 10; cur.summary = p[1] || ''; return; }
    // 직전 문항의 푸는 순서: "~ 단계 / 단계"
    if (line.startsWith('~ ')) { if (st.last) st.last.how = line.slice(2).trim(); return; }
    // 한 줄 문항: ?: 객관식(첫 보기가 정답) / ?o O·X / ?= 계산 / ?- 서술. 기호 뒤 +는 심화
    const one = line.match(/^\?([:o=\-])(\+?) (.*)$/);
    if (one) {
      const p = one[3].split(' | ').map(x => x.trim()), kind = one[1];
      if (kind === ':') { newQ('mc', p[0]); st.q.opts = p.slice(1, -1); st.q.ans = 0; st.q.why = p[p.length - 1]; }
      else if (kind === 'o') { newQ('mc', p[0]); st.q.opts = ['O (맞다)', 'X (틀리다)']; st.q.ans = /^o$/i.test(p[1]) ? 0 : 1; st.q.why = p[2] || ''; st.q.ox = true; }
      else if (kind === '=') { newQ('num', p[0]); st.q.ans = parseFloat(p[1]); st.q.tol = p[2] !== '' && p[2] !== undefined ? parseFloat(p[2]) : Math.abs(st.q.ans) * 0.01; st.q.unit = p[3] || ''; st.q.why = p.slice(4).join(' | '); }
      else { newQ('text', p[0]); st.q.why = p.slice(1).join(' | '); }
      if (one[2]) st.q.adv = true;
      st.q = null; return;
    }
    if (line.startsWith('?? ')) { newQ('mc', line.slice(3)); return; }
    if (line.startsWith('?# ')) { newQ('num', line.slice(3)); return; }
    if (line.startsWith('?~ ')) { newQ('text', line.slice(3)); return; }
    if (line.startsWith('>> ')) { st.a = { id: cur.id + '#' + cur.actions.length, title: line.slice(3).trim(), why: '', how: '', out: '' }; cur.actions.push(st.a); st.q = null; return; }
    if (st.a) {
      const m = line.match(/^(why|how|out): (.*)$/);
      if (m) { st.a[m[1]] = m[2].trim(); return; }
      if (line.trim() === '') return;
      st.a = null;
    }
    if (st.q) {
      const q = st.q;
      if (q.type === 'mc') {
        if (line.startsWith('- ')) { q.opts.push(line.slice(2).trim()); return; }
        if (line.startsWith('* ')) { q.ans = q.opts.length; q.opts.push(line.slice(2).trim()); return; }
        if (line.startsWith('= ')) { q.why = line.slice(2).trim(); st.q = null; return; }
      } else if (line.startsWith('= ')) {
        if (q.type === 'num') { const p = line.slice(2).split('|').map(x => x.trim()); q.ans = parseFloat(p[0]); q.tol = p[1] !== undefined && p[1] !== '' ? parseFloat(p[1]) : Math.abs(q.ans) * 0.01; q.unit = p[2] || ''; q.why = p.slice(3).join(' | '); }
        else q.why = line.slice(2).trim();
        st.q = null; return;
      }
      if (line.trim() === '') return;
      st.q = null;
    }
    if (line.startsWith('!! ')) { cur.mission = line.slice(3).trim(); return; }
    if (st.body) cur.body.push(line);
  }

  function parseTrack(slug, text) {
    const track = { slug, title: '', desc: '', lessons: [] };
    let cur = null, st = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^## \[([\w-]+)\] (.+)$/);
      if (m) {
        cur = { id: m[1], track: slug, title: m[2].trim(), min: 10, summary: '', body: [], quiz: [], actions: [], mission: '' };
        st = { q: null, a: null, body: true };
        track.lessons.push(cur); continue;
      }
      if (!cur) {
        if (line.startsWith('# ')) track.title = line.slice(2).trim();
        else if (line.startsWith('> ')) track.desc += (track.desc ? ' ' : '') + line.slice(2).trim();
        continue;
      }
      feed(cur, st, line);
    }
    return track;
  }

  /* 보강 파일: "## [레슨id]" 아래에 문항과 실행 예시를 추가로 적은 파일을 기존 레슨에 합친다 */
  function mergeExtras(byId, text) {
    let cur = null, st = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^## \[([\w-]+)\]/);
      if (m) { cur = byId[m[1]] || null; st = { q: null, a: null, body: false }; continue; }
      if (cur) feed(cur, st, line);
    }
  }

  /* 푸는 순서 파일: "## [레슨id]" 아래 "문항번호. 단계 / 단계" */
  function mergeHows(byId, text) {
    let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^## \[([\w-]+)\]/);
      if (m) { cur = byId[m[1]] || null; continue; }
      const h = cur && line.match(/^(\d+)\. (.+)$/);
      if (h && cur.quiz[+h[1] - 1]) cur.quiz[+h[1] - 1].how = h[2].trim();
      const g = cur && line.match(/^(\d+)! (.+)$/);           // "번호! 이 문제를 푸는 이유"
      if (g && cur.quiz[+g[1] - 1]) cur.quiz[+g[1] - 1].goal = g[2].trim();
    }
  }

  /* 실무 방법 사전: "@ 키워드 | 키워드" / "# 제목" / "- 단계" / "> 예시" 블록의 목록 */
  function parseHowto(text) {
    const out = []; let cur = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('@ ')) { cur = { keys: line.slice(2).split('|').map(x => x.trim()).filter(Boolean), title: '', steps: [], note: '', why: '', origin: '', gist: '' }; out.push(cur); }
      else if (!cur) continue;
      else if (line.startsWith('# ')) cur.title = line.slice(2).trim();
      else if (line.startsWith('- ')) cur.steps.push(line.slice(2).trim());
      else if (line.startsWith('> ')) cur.note = line.slice(2).trim();
      else if (line.startsWith('? ')) cur.why = line.slice(2).trim();      // 왜 필요한가, 어떤 문제를 푸는가
      else if (line.startsWith('^ ')) cur.origin = line.slice(2).trim();   // 어디서 나왔나
      else if (line.startsWith('= ')) cur.gist = line.slice(2).trim();     // 쉬운 말 한 줄
    }
    return out.filter(h => h.title && (h.steps.length || h.gist));
  }

  /* 용어 풀이: "한글 | 漢字 | 글자 풀이 | English | 영어 발음" → { 한글: {hanja, parts, en, say} } */
  function parseTerms(text) {
    const out = {};
    for (const line of text.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const c = line.split('|').map(x => x.trim());
      if (c.length >= 5 && c[0]) out[c[0]] = { hanja: c[1], parts: c[2], en: c[3], say: c[4] };
    }
    return out;
  }

  /* 용어 사전: "한글=English" 줄 목록 */
  function parseGlossary(text) {
    const out = [];
    for (const line of text.split('\n')) { const k = line.indexOf('='); if (k > 0 && !line.startsWith('#')) out.push([line.slice(0, k).trim(), line.slice(k + 1).trim()]); }
    return out.sort((a, b) => b[0].length - a[0].length);
  }

  /* ---------- 마크다운 렌더러 (필요한 문법만) ---------- */
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function md(lines) {
    const out = []; let i = 0;
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { i++; continue; }
      if (l.startsWith('```')) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
        i++; out.push('<div class="scroll"><pre>' + esc(buf.join('\n')) + '</pre></div>'); continue;
      }
      if (l.startsWith('### ')) { out.push('<h3>' + inline(l.slice(4)) + '</h3>'); i++; continue; }
      if (l.startsWith('> ')) {
        const buf = [];
        while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) buf.push(inline(lines[i++].slice(2)));
        out.push('<div class="callout">' + buf.join('<br>') + '</div>'); continue;
      }
      if (l.trim().startsWith('|')) {
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
        const head = cells(rows[0]);
        const body = rows.slice(/^\s*\|[\s:|-]+\|\s*$/.test(rows[1] || '') ? 2 : 1).map(cells);
        out.push('<div class="scroll"><table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>'); continue;
      }
      if (/^- /.test(l) || /^\d+\. /.test(l)) {
        const ordered = /^\d+\. /.test(l); const re = ordered ? /^\d+\. / : /^- /; const items = [];
        while (i < lines.length && (re.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
          if (re.test(lines[i])) items.push(inline(lines[i].replace(re, '')));
          else items[items.length - 1] += '<br><span class="sub">' + inline(lines[i].trim().replace(/^- /, '· ')) + '</span>';
          i++;
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.map(x => '<li>' + x + '</li>').join('') + (ordered ? '</ol>' : '</ul>')); continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(### |> |```|- |\d+\. |\s*\|)/.test(lines[i])) buf.push(inline(lines[i++]));
      out.push('<p>' + buf.join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  /* ---------- 상태 ---------- */
  function emptyState() { return { v: 1, resetAt: 0, done: {}, quiz: {}, notes: {}, mission: {}, days: {} }; }

  function canon(x) {
    if (Array.isArray(x)) return x.map(canon);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = canon(x[k]); return o; }
    return x;
  }
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  /* 두 기기의 상태 병합. 항목별로 최신 것을 고르고, 초기화 시점 이전 기록은 버린다. */
  function merge(a, b) {
    a = Object.assign(emptyState(), a || {}); b = Object.assign(emptyState(), b || {});
    const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
    const out = emptyState(); out.resetAt = resetAt;
    const keys = (x, y) => new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
    for (const k of keys(a.done, b.done)) {            // 완료: 먼저 완료한 시각 유지
      const t = Math.min(a.done[k] || Infinity, b.done[k] || Infinity);
      if (t > resetAt) out.done[k] = t;
    }
    for (const k of keys(a.mission, b.mission)) {
      const t = Math.min(a.mission[k] || Infinity, b.mission[k] || Infinity);
      if (t > resetAt) out.mission[k] = t;
    }
    for (const k of keys(a.quiz, b.quiz)) {            // 퀴즈: 마지막으로 푼 기록
      const x = a.quiz[k], y = b.quiz[k];
      const w = !x ? y : !y ? x : (y.last > x.last ? y : x);
      if (w && w.last > resetAt) out.quiz[k] = w;
    }
    for (const k of keys(a.notes, b.notes)) {          // 메모: 마지막 수정본
      const x = a.notes[k], y = b.notes[k];
      const w = !x ? y : !y ? x : (y.ts > x.ts ? y : x);
      if (w && w.ts > resetAt) out.notes[k] = w;
    }
    for (const k of keys(a.days, b.days)) {            // 일별 활동량: 큰 값
      const day = Date.parse(k + 'T23:59:59');
      if (!(day > resetAt)) continue;
      out.days[k] = Math.max(a.days[k] || 0, b.days[k] || 0);
    }
    return canon(out);
  }

  /* ---------- 간격 반복 (Leitner) ---------- */
  const DAY = 86400000;
  const INTERVALS = [0, 1, 3, 7, 16, 35]; // 상자별 다음 복습까지 일수
  function schedule(prev, ok, now) {
    const box = ok ? Math.min((prev ? prev.box : 0) + 1, INTERVALS.length - 1) : 0;
    return { box, ok: !!ok, last: now, next: ok ? now + INTERVALS[box] * DAY : now + 10 * 60000 };
  }
  function dueIds(state, now) {
    return Object.keys(state.quiz).filter(k => state.quiz[k].next <= now).sort((x, y) => state.quiz[x].next - state.quiz[y].next);
  }

  function dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function streak(state, now) {
    let n = 0, t = now;
    if (!state.days[dayKey(t)]) t -= DAY;       // 오늘 아직 안 했어도 어제까지의 연속은 유지
    while (state.days[dayKey(t)]) { n++; t -= DAY; }
    return n;
  }

  /* ---------- Gist 동기화 ---------- */
  const FILE = 'cpo-academy-state.json';
  /* ---------- 잠금: 암호 → 데이터 키, 암호화와 복호화 (WebCrypto) ---------- */
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const subtle = () => root.crypto.subtle;
  const importKey = raw => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  /* lock.json 과 암호로 데이터 키(base64)를 꺼낸다. 암호가 틀리면 예외 */
  async function unwrapKey(pass, lock) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(pass.normalize('NFKC').trim()), 'PBKDF2', false, ['deriveKey']);
    const kek = await subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(lock.salt), iterations: lock.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return b64(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) }, kek, unb64(lock.key))));
  }
  async function decryptBytes(key, u8) { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12))); }
  async function encryptBytes(key, u8) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, u8));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  async function gunzip(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
  const ENC = 'enc1:';
  async function encText(key, text) { return ENC + b64(await encryptBytes(key, new TextEncoder().encode(text))); }
  async function decText(key, s) { return new TextDecoder().decode(await decryptBytes(key, unb64(s.slice(ENC.length)))); }

  /* codec({enc, dec})이 있으면 Gist에 올리는 모든 내용을 암호화한다. 암호화 전 데이터는 읽을 때 plain 으로 표시해 다시 올리게 한다 */
  function makeSync(fetchFn, token, file, codec) {
    file = file || FILE;
    const out = async t => codec ? await codec.enc(t) : t;
    async function gh(path, opt) {
      opt = opt || {};
      const r = await fetchFn('https://api.github.com' + path, {
        method: opt.method || 'GET', cache: 'no-store', body: opt.body,
        headers: Object.assign({ 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token },
          opt.body ? { 'Content-Type': 'application/json' } : {})
      });
      if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
      return r.status === 204 ? null : r.json();
    }
    return {
      async find() {
        for (let p = 1; p <= 5; p++) {
          const list = await gh('/gists?per_page=100&page=' + p);
          const g = list.find(g => g.files && g.files[file]);
          if (g) return g.id;
          if (list.length < 100) break;
        }
        return null;
      },
      async create(state) {
        const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'CPO Academy 학습 진도 (자동 동기화)', public: false, files: { [file]: { content: await out(JSON.stringify(state)) } } }) });
        return g.id;
      },
      /* 진도 상태와 함께, 같은 Gist에 있는 비공개 트랙 파일(cpo-academy-private*.md)도 읽는다 */
      async pull(id) {
        const g = await gh('/gists/' + id);
        const read = async f => f.truncated ? await (await fetchFn(f.raw_url, { cache: 'no-store' })).text() : f.content;
        const plain = [];
        const open = async (name, s) => {
          if (typeof s === 'string' && s.startsWith(ENC)) {
            if (!codec) { const e = new Error('locked'); e.code = 'key'; throw e; }
            try { return await codec.dec(s); } catch (x) { const e = new Error('key'); e.code = 'key'; throw e; }
          }
          plain.push(name); return s;
        };
        let state = emptyState();
        if (g.files[file]) { const raw = await open(file, await read(g.files[file])); try { state = JSON.parse(raw); } catch (e) { } }
        const priv = {};
        for (const name of Object.keys(g.files).sort()) {
          const m = name.match(/^cpo-academy-private-?([\w]*)\.md$/);
          if (m) priv[m[1] || 'me'] = await open(name, await read(g.files[name]));
        }
        return { state, priv, plain: codec ? plain : [] };
      },
      async push(id, state) {
        await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [file]: { content: await out(JSON.stringify(state)) } } }) });
      },
      /* 비공개 트랙 파일을 Gist에 추가하거나 교체 (content가 null이면 삭제) */
      async putFile(id, name, content) {
        await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [name]: content == null ? null : { content: await out(content) } } }) });
      },
      async remove(id) { await gh('/gists/' + id, { method: 'DELETE' }); }
    };
  }

  root.Core = { parseTrack, mergeExtras, mergeHows, parseHowto, parseTerms, parseGlossary, md, esc, inline, emptyState, canon, same, merge, schedule, dueIds, dayKey, streak, makeSync, unb64, importKey, unwrapKey, decryptBytes, gunzip, encText, decText, INTERVALS, DAY, FILE };
})(typeof window !== 'undefined' ? window : globalThis);
