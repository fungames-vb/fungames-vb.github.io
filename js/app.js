/* =========================================================
   VB-FUNGAME — logika aplikasi
   Alur: home → players → teams → pockets → shuffle → fungame
   ========================================================= */
(() => {
  'use strict';

  // ---------- Konfigurasi ----------
  const PLAYERS_PER_TEAM = 6;
  const POCKETS = [
    { id: 'P1', key: 'pocket.1', short: 'K1' },
    { id: 'P2', key: 'pocket.2', short: 'K2' },
    { id: 'P3', key: 'pocket.3', short: 'K3' },
    { id: 'P4', key: 'pocket.4', short: 'K4' },
    { id: 'P5', key: 'pocket.5', short: 'K5' },
    { id: 'S',  key: 'pocket.S', short: 'SET' },
  ];
  const PALETTE = ['#e8542f', '#2f6fe8', '#1fb5a5', '#e8b84a', '#d63a5a', '#7a4de8', '#2fb85e', '#e84a9a'];
  const SHUFFLE_SPEED = { flickerTicks: 14, flickerMs: 70, revealMs: 380, pocketPauseMs: 500 };
  const STORAGE_KEY = 'vbfungame-session';
  const LANG_KEY = 'vbfungame-lang';

  // ---------- State ----------
  const state = {
    sessionTitle: '',
    community: '',
    mode: 0,            // 18 | 24
    teamCount: 0,       // 3 | 4
    players: [],
    teams: [],          // [{ name, color }]
    pockets: {},        // { P1: [idx], ... }
    activePocket: 'P1',
    isShuffling: false,
    result: null,       // [{ P1: 'Nama', ..., S: 'Nama' }] per tim
    fungame: null,      // { setFormat, matches: [{ id, n, round, a, b, sets: [{a,b}], done }] }
    showMatches: false, // tampilkan detail laga saat hasil akhir sudah keluar
  };
  let currentScreen = 'home';

  // ---------- i18n ----------
  let lang = localStorage.getItem(LANG_KEY) || 'id';
  const dict = () => window.VB_I18N[lang] || window.VB_I18N.id;
  const t = (key, vars = {}) => {
    let s = dict()[key] ?? window.VB_I18N.id[key] ?? key;
    if (typeof s !== 'string') return s;
    Object.entries(vars).forEach(([k, v]) => (s = s.replaceAll(`{${k}}`, v)));
    return s;
  };
  const pocketLabel = (p) => t(p.key);
  const shortLabel = (p) => (p.id === 'S' ? 'SET' : (lang === 'en' ? 'P' : 'K') + p.id.slice(1));

  function applyStaticI18n() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((n) => (n.textContent = t(n.dataset.i18n)));
    $$('[data-i18n-html]').forEach((n) => (n.innerHTML = t(n.dataset.i18nHtml)));
    $$('[data-i18n-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
    $$('[data-i18n-aria]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.i18nAria)));
    $$('[data-i18n-attr]').forEach((n) => {
      const [attr, key] = n.dataset.i18nAttr.split(':');
      n.setAttribute(attr, t(key));
    });
    $$('#lang-switch button').forEach((b) => {
      const on = b.dataset.lang === lang;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function setLang(next) {
    lang = next;
    localStorage.setItem(LANG_KEY, lang);
    applyStaticI18n();
    renderers[currentScreen]?.();
  }
  $$('#lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  // ---------- Helpers ----------
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const shuffleArray = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  };
  const badge = (team, cls = 'match-team__badge') => {
    const b = el('span', { class: cls, text: team.name.trim().charAt(0).toUpperCase() || '?' });
    b.style.background = team.color;
    return b;
  };
  const resetPockets = () => {
    state.pockets = {};
    POCKETS.forEach((p) => (state.pockets[p.id] = []));
    state.activePocket = 'P1';
  };
  const assignedIndices = () => new Set(Object.values(state.pockets).flat());

  // ---------- Persistensi ----------
  function saveSession() {
    try {
      const { isShuffling, ...data } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
    } catch (_) { /* abaikan */ }
  }
  function loadSession() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }
  const clearSession = () => localStorage.removeItem(STORAGE_KEY);

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg, type) {
    const toast = $('#toast');
    $('#toast-tag').textContent = type === 'error' ? pick(t('toast.fouls')) : t('toast.cheer');
    $('#toast-msg').textContent = msg;
    toast.classList.toggle('toast--success', type === 'success');
    toast.hidden = false;
    toast.style.animation = 'none';
    void toast.offsetWidth;
    toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3400);
  }
  const foul = (msg) => showToast(msg, 'error');
  const cheer = (msg) => showToast(msg, 'success');
  const shake = (node) => { node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); };

  // ---------- Navigasi ----------
  const SCREEN_ORDER = ['home', 'players', 'teams', 'pockets', 'shuffle', 'fungame'];
  const renderers = {};

  function goTo(name) {
    if (state.isShuffling) return foul(t('shuffle.busy'));
    currentScreen = name;
    $$('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
    const idx = SCREEN_ORDER.indexOf(name);
    $$('#stepper li').forEach((li, i) => {
      li.classList.toggle('is-active', i === idx);
      li.classList.toggle('is-done', i < idx);
    });
    renderers[name]?.();
    if (name !== 'home' && state.mode) saveSession();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => goTo(btn.dataset.goto)));
  $('#brand-btn').addEventListener('click', () => goTo('home'));

  // ---------- 1. HOME ----------
  $('#session-title').addEventListener('input', (e) => (state.sessionTitle = e.target.value));
  $('#session-community').addEventListener('input', (e) => (state.community = e.target.value));

  $$('#screen-home .mode-card').forEach((card) =>
    card.addEventListener('click', () => {
      state.sessionTitle = state.sessionTitle.trim();
      state.community = state.community.trim();
      if (!state.sessionTitle) { shake($('.session-form')); $('#session-title').focus(); return foul(t('home.needTitle')); }
      if (!state.community) { shake($('.session-form')); $('#session-community').focus(); return foul(t('home.needCommunity')); }

      const mode = Number(card.dataset.mode);
      state.mode = mode;
      state.teamCount = mode / PLAYERS_PER_TEAM;
      state.players = Array(mode).fill('');
      const defaults = t('teamDefaults');
      state.teams = Array.from({ length: state.teamCount }, (_, i) => ({
        name: defaults[i] || `Team ${i + 1}`,
        color: PALETTE[i % PALETTE.length],
      }));
      resetPockets();
      state.result = null;
      state.fungame = null;
      state.showMatches = false;
      goTo('players');
    })
  );

  renderers.home = () => {
    $('#session-title').value = state.sessionTitle;
    $('#session-community').value = state.community;
    const saved = loadSession();
    const bar = $('#resume-bar');
    if (!saved || !saved.mode) return (bar.hidden = true);
    const when = new Date(saved.savedAt).toLocaleString(t('locale'), { dateStyle: 'medium', timeStyle: 'short' });
    const stage = saved.fungame
      ? (saved.fungame.matches.every((m) => m.done) ? 'home.stage.done' : 'home.stage.fungame')
      : saved.result ? 'home.stage.shuffled' : 'home.stage.setup';
    $('#resume-text').textContent = t('home.resumeText', {
      title: saved.sessionTitle || t('home.untitled'), players: saved.mode, stage: t(stage), when,
    });
    bar.hidden = false;
  };
  $('#btn-resume').addEventListener('click', () => {
    const saved = loadSession();
    if (!saved) return foul(t('home.sessionNotFound'));
    Object.assign(state, saved, { isShuffling: false });
    if (!state.pockets || !Object.keys(state.pockets).length) resetPockets();
    goTo(state.fungame ? 'fungame' : state.result ? 'shuffle' : 'players');
  });
  $('#btn-discard').addEventListener('click', () => {
    clearSession();
    renderers.home();
    cheer(t('home.sessionDeleted'));
  });

  // ---------- 2. PLAYERS ----------
  renderers.players = () => {
    $('#players-sub').textContent = t('players.sub', { n: state.mode });
    const grid = $('#players-grid');
    grid.innerHTML = '';
    state.players.forEach((name, i) => {
      const input = el('input', {
        type: 'text', value: name, maxlength: '24',
        placeholder: t('players.placeholder', { n: i + 1 }),
        'aria-label': t('players.placeholder', { n: i + 1 }),
        oninput: (e) => { state.players[i] = e.target.value; e.target.parentElement.classList.remove('is-error'); },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            const next = grid.querySelectorAll('input')[i + 1];
            next ? next.focus() : $('#btn-players-next').click();
          }
        },
      });
      grid.appendChild(el('div', { class: 'player-field' }, [el('span', { class: 'player-field__num', text: i + 1 }), input]));
    });
  };
  $('#btn-fill-sample').addEventListener('click', () => {
    state.players = state.players.map((_, i) => t('players.sample', { n: i + 1 }));
    renderers.players();
  });
  $('#btn-clear-players').addEventListener('click', () => {
    state.players = state.players.map(() => '');
    resetPockets();
    renderers.players();
  });

  function validatePlayers() {
    const fields = $$('#players-grid .player-field');
    const seen = new Map();
    let empty = 0, dup = 0;
    state.players.forEach((raw, i) => {
      const name = raw.trim();
      state.players[i] = name;
      if (!name) { empty++; fields[i].classList.add('is-error'); return; }
      const key = name.toLowerCase();
      if (seen.has(key)) { dup++; fields[i].classList.add('is-error'); fields[seen.get(key)].classList.add('is-error'); }
      else seen.set(key, i);
    });
    if (empty) return foul(t('players.errEmpty', { n: empty })), false;
    if (dup) return foul(t('players.errDup')), false;
    return true;
  }
  $('#btn-players-next').addEventListener('click', () => {
    if (!validatePlayers()) return shake($('#players-grid'));
    goTo('teams');
  });

  // ---------- 3. TEAMS ----------
  renderers.teams = () => {
    const grid = $('#teams-grid');
    grid.innerHTML = '';
    state.teams.forEach((team, i) => {
      const jersey = el('div', { class: 'jersey', text: team.name.trim().charAt(0).toUpperCase() || (i + 1) });
      jersey.style.background = team.color;
      const input = el('input', {
        type: 'text', value: team.name, maxlength: '18',
        placeholder: t('teams.placeholder', { n: i + 1 }), 'aria-label': t('teams.placeholder', { n: i + 1 }),
        oninput: (e) => { team.name = e.target.value; jersey.textContent = team.name.trim().charAt(0).toUpperCase() || (i + 1); },
      });
      const swatches = el('div', { class: 'swatches' });
      PALETTE.forEach((color) => {
        const sw = el('button', {
          type: 'button', class: `swatch${team.color === color ? ' is-selected' : ''}`, 'aria-label': t('teams.color', { c: color }),
          onclick: () => {
            team.color = color; jersey.style.background = color;
            $$('.swatch', swatches).forEach((s) => s.classList.remove('is-selected'));
            sw.classList.add('is-selected');
          },
        });
        sw.style.background = color;
        swatches.appendChild(sw);
      });
      grid.appendChild(el('div', { class: 'team-card card' }, [jersey, input, swatches]));
    });
  };
  function validateTeams() {
    const seen = new Set();
    for (const [i, tm] of state.teams.entries()) {
      tm.name = tm.name.trim();
      if (!tm.name) return foul(t('teams.errEmpty', { n: i + 1 })), false;
      const key = tm.name.toLowerCase();
      if (seen.has(key)) return foul(t('teams.errDup', { name: tm.name })), false;
      seen.add(key);
    }
    if (new Set(state.teams.map((x) => x.color)).size < state.teams.length) return foul(t('teams.errColor')), false;
    return true;
  }
  $('#btn-teams-next').addEventListener('click', () => {
    if (!validateTeams()) return shake($('#teams-grid'));
    goTo('pockets');
  });

  // ---------- 4. POCKETS ----------
  renderers.pockets = () => {
    $('#pockets-sub').textContent = t('pockets.sub', { n: state.teamCount });
    renderPocketTabs();
    renderPocketPanel();
  };
  function renderPocketTabs() {
    const tabs = $('#pocket-tabs');
    tabs.innerHTML = '';
    POCKETS.forEach((p) => {
      const count = state.pockets[p.id].length;
      const full = count === state.teamCount;
      tabs.appendChild(el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(state.activePocket === p.id),
        class: `pocket-tab${state.activePocket === p.id ? ' is-active' : ''}${full ? ' is-full' : ''}${p.id === 'S' ? ' pocket-tab--setter' : ''}`,
        onclick: () => { state.activePocket = p.id; renderers.pockets(); },
      }, [el('span', { text: pocketLabel(p) }), el('span', { class: 'pocket-tab__count', text: `${count}/${state.teamCount}` })]));
    });
  }
  function renderPocketPanel() {
    const pocket = POCKETS.find((p) => p.id === state.activePocket);
    const members = state.pockets[pocket.id];
    $('#active-pocket-title').textContent = pocketLabel(pocket);
    $('#active-pocket-count').textContent = `${members.length} / ${state.teamCount}`;

    const memberBox = $('#pocket-members');
    memberBox.innerHTML = '';
    members.forEach((idx) => memberBox.appendChild(el('button', {
      type: 'button', class: 'chip chip--member', text: state.players[idx], title: t('pockets.removeTitle'),
      onclick: () => { state.pockets[pocket.id] = state.pockets[pocket.id].filter((i) => i !== idx); renderers.pockets(); },
    })));

    const assigned = assignedIndices();
    const pool = $('#pool-chips');
    pool.innerHTML = '';
    let poolCount = 0;
    state.players.forEach((name, idx) => {
      if (assigned.has(idx)) return;
      poolCount++;
      pool.appendChild(el('button', { type: 'button', class: 'chip', onclick: () => addToActivePocket(idx) },
        [el('span', { class: 'chip__num', text: `#${idx + 1}` }), el('span', { text: name })]));
    });
    $('#pool-count').textContent = poolCount;
  }
  function addToActivePocket(idx) {
    const id = state.activePocket;
    const pocket = POCKETS.find((p) => p.id === id);
    if (state.pockets[id].length >= state.teamCount) {
      foul(t('pockets.full', { pocket: pocketLabel(pocket), n: state.teamCount }));
      return shake($('#pocket-members'));
    }
    state.pockets[id].push(idx);
    if (state.pockets[id].length === state.teamCount) {
      const next = POCKETS.find((p) => state.pockets[p.id].length < state.teamCount);
      if (next) { state.activePocket = next.id; cheer(t('pockets.complete', { pocket: pocketLabel(pocket), next: pocketLabel(next) })); }
      else cheer(t('pockets.allFull'));
    }
    renderers.pockets();
  }
  $('#btn-autofill').addEventListener('click', () => {
    const free = shuffleArray(state.players.map((_, i) => i).filter((i) => !assignedIndices().has(i)));
    if (!free.length) return cheer(t('pockets.allAssigned'));
    POCKETS.forEach((p) => { while (state.pockets[p.id].length < state.teamCount && free.length) state.pockets[p.id].push(free.pop()); });
    cheer(t('pockets.autofilled'));
    renderers.pockets();
  });
  $('#btn-reset-pockets').addEventListener('click', () => { resetPockets(); renderers.pockets(); });

  function validatePockets() {
    const problems = POCKETS.filter((p) => state.pockets[p.id].length !== state.teamCount);
    if (problems.length) {
      const detail = problems.map((p) => `${pocketLabel(p)} (${state.pockets[p.id].length}/${state.teamCount})`).join(', ');
      foul(t('pockets.errIncomplete', { detail }));
      state.activePocket = problems[0].id;
      renderers.pockets();
      return false;
    }
    const total = Object.values(state.pockets).flat().length;
    if (total !== state.players.length) return foul(t('pockets.errMismatch', { a: total, b: state.players.length })), false;
    return true;
  }
  $('#btn-pockets-next').addEventListener('click', () => {
    if (!validatePockets()) return shake($('#pocket-tabs'));
    goTo('shuffle');
  });

  // ---------- 5. SHUFFLE ----------
  renderers.shuffle = () => {
    $('#shuffle-title').textContent = t('shuffle.title');
    $('#shuffle-status').textContent = t('shuffle.status');
    const startBtn = $('#btn-start-shuffle');
    startBtn.hidden = false; startBtn.disabled = false; startBtn.textContent = t('shuffle.start');
    $('#btn-new-session').hidden = true;
    $('#btn-to-fungame').hidden = true;
    $('#btn-shuffle-back').disabled = false;

    const bar = $('#shuffle-pockets');
    bar.innerHTML = '';
    POCKETS.forEach((p) => bar.appendChild(el('span', { class: 'shuffle-pocket', 'data-pocket': p.id, text: pocketLabel(p) })));

    const grid = $('#result-grid');
    grid.innerHTML = '';
    state.teams.forEach((team, ti) => {
      const head = el('div', { class: 'team-col__head' }, [badge(team, 'team-col__badge'), el('span', { text: team.name })]);
      head.style.background = team.color;
      const slots = el('div', { class: 'slots' });
      POCKETS.forEach((p) => slots.appendChild(el('div', { class: `slot${p.id === 'S' ? ' slot--setter' : ''}`, 'data-team': ti, 'data-pocket': p.id }, [
        el('span', { class: 'slot__pos', text: shortLabel(p) }),
        el('span', { class: 'slot__name', text: '—' }),
      ])));
      grid.appendChild(el('div', { class: 'team-col card', 'data-team': ti }, [head, slots]));
    });
    if (state.result) showFinalResult(state.result, true);
  };

  function showFinalResult(result, silent = false) {
    result.forEach((team, ti) => POCKETS.forEach((p) => {
      const slot = $(`.slot[data-team="${ti}"][data-pocket="${p.id}"]`);
      slot.querySelector('.slot__name').textContent = team[p.id];
      slot.classList.add('is-revealed');
    }));
    $$('.shuffle-pocket').forEach((tag) => tag.classList.add('is-done'));
    if (!silent) $$('.team-col').forEach((col) => col.classList.add('is-complete'));
    $('#shuffle-title').textContent = t('shuffle.done');
    $('#shuffle-status').textContent = state.fungame ? t('shuffle.doneStatusLocked') : t('shuffle.doneStatus', { n: state.teamCount });
    $('#btn-start-shuffle').textContent = t('shuffle.again');
    $('#btn-new-session').hidden = false;
    $('#btn-to-fungame').hidden = false;
  }

  async function runShuffle() {
    if (state.isShuffling) return;
    if (!validatePockets()) return goTo('pockets');
    if (state.fungame && !confirm(t('shuffle.confirmReshuffle'))) return;

    state.result = null;
    state.fungame = null;
    state.isShuffling = true;
    renderers.shuffle();
    const startBtn = $('#btn-start-shuffle');
    startBtn.disabled = true;
    startBtn.textContent = t('shuffle.running');
    $('#btn-shuffle-back').disabled = true;

    const result = state.teams.map(() => ({}));
    for (const pocket of POCKETS) {
      const names = state.pockets[pocket.id].map((i) => state.players[i]);
      const order = shuffleArray(names);
      const slots = $$(`.slot[data-pocket="${pocket.id}"]`);
      const tag = $(`.shuffle-pocket[data-pocket="${pocket.id}"]`);
      tag.classList.add('is-current');
      $('#shuffle-status').textContent = t('shuffle.shuffling', { pocket: pocketLabel(pocket) });

      let revealed = 0;
      const flicker = () => {
        const remaining = order.slice(revealed);
        for (let i = revealed; i < slots.length; i++) slots[i].querySelector('.slot__name').textContent = pick(remaining);
      };
      slots.forEach((s) => s.classList.add('is-spinning'));
      const ticker = setInterval(flicker, SHUFFLE_SPEED.flickerMs);
      await delay(SHUFFLE_SPEED.flickerTicks * SHUFFLE_SPEED.flickerMs);
      for (let i = 0; i < slots.length; i++) {
        slots[i].classList.remove('is-spinning');
        slots[i].querySelector('.slot__name').textContent = order[i];
        slots[i].classList.add('is-revealed');
        result[i][pocket.id] = order[i];
        revealed = i + 1;
        await delay(SHUFFLE_SPEED.revealMs);
      }
      clearInterval(ticker);
      tag.classList.remove('is-current');
      tag.classList.add('is-done');
      await delay(SHUFFLE_SPEED.pocketPauseMs);
    }

    state.result = result;
    state.isShuffling = false;
    startBtn.disabled = false;
    $('#btn-shuffle-back').disabled = false;
    showFinalResult(result);
    cheer(t('shuffle.whistle'));
    saveSession();
  }
  $('#btn-start-shuffle').addEventListener('click', runShuffle);
  $('#btn-to-fungame').addEventListener('click', () => {
    if (!state.result) return foul(t('shuffle.notYet'));
    if (!state.fungame) state.fungame = buildFungame(1);
    saveSession();
    goTo('fungame');
  });
  const startNewSession = () => {
    if (state.result && !confirm(t('shuffle.confirmNew'))) return;
    clearSession();
    Object.assign(state, { sessionTitle: '', community: '', mode: 0, result: null, fungame: null, showMatches: false });
    goTo('home');
  };
  $('#btn-new-session').addEventListener('click', startNewSession);
  $('#btn-fungame-new').addEventListener('click', startNewSession);

  // ---------- 6. FUNGAME (round robin + poin FIVB) ----------
  // Poin FIVB: menang 3-0/3-1 → 3, menang 3-2 → 2, kalah 2-3 → 1, kalah lainnya → 0.
  // Best-of-3: 2-0 → 3/0, 2-1 → 2/1. 1 set: menang 3, kalah 0.
  function fivbPoints(w, l) {
    const total = w + l;
    if (w > l) return w - l === 1 && total >= 3 ? 2 : 3;
    return l - w === 1 && total >= 3 ? 1 : 0;
  }
  const setsNeeded = () => Math.ceil(state.fungame.setFormat / 2);
  const setsWon = (m) => m.sets.reduce((acc, s) => { if (s.a > s.b) acc.a++; else if (s.b > s.a) acc.b++; return acc; }, { a: 0, b: 0 });
  const pointsTotal = (m) => m.sets.reduce((acc, s) => ({ a: acc.a + s.a, b: acc.b + s.b }), { a: 0, b: 0 });
  const winnerOf = (m) => { const s = setsWon(m); return s.a > s.b ? m.a : m.b; };
  const matchLabel = (m) => t('fungame.match', { n: m.n });
  const roundLabel = (m) => (m.round ? t('fungame.round', { n: m.round }) : t('fungame.roundRobin'));

  function buildFungame(setFormat) {
    const ids = shuffleArray(state.teams.map((_, i) => i));
    const matches = [];
    const add = (a, b, round) => matches.push({ id: `M${matches.length + 1}`, n: matches.length + 1, round, a, b, sets: [], done: false });
    if (ids.length === 4) {
      const [t1, t2, t3, t4] = ids;
      [[[t1, t2], [t3, t4]], [[t1, t3], [t2, t4]], [[t1, t4], [t2, t3]]]
        .forEach((pairs, r) => pairs.forEach(([a, b]) => add(a, b, r + 1)));
    } else {
      const [t1, t2, t3] = ids;
      [[t1, t2], [t2, t3], [t3, t1]].forEach(([a, b]) => add(a, b, null));
    }
    return { setFormat, matches };
  }

  const ratio = (w, l) => (l === 0 ? (w > 0 ? Infinity : 0) : w / l);
  const fmtRatio = (r) => (r === Infinity ? 'MAX' : r.toFixed(3));

  function computeStandings() {
    const rows = state.teams.map((_, i) => ({ team: i, played: 0, won: 0, lost: 0, pts: 0, setW: 0, setL: 0, pf: 0, pa: 0 }));
    state.fungame.matches.filter((m) => m.done).forEach((m) => {
      const A = rows[m.a], B = rows[m.b];
      const s = setsWon(m), p = pointsTotal(m);
      A.played++; B.played++;
      A.setW += s.a; A.setL += s.b; B.setW += s.b; B.setL += s.a;
      A.pf += p.a; A.pa += p.b; B.pf += p.b; B.pa += p.a;
      A.pts += fivbPoints(s.a, s.b); B.pts += fivbPoints(s.b, s.a);
      if (s.a > s.b) { A.won++; B.lost++; } else { B.won++; A.lost++; }
    });
    rows.forEach((r) => { r.setRatio = ratio(r.setW, r.setL); r.ptRatio = ratio(r.pf, r.pa); });
    return rows.sort((x, y) => y.pts - x.pts || y.won - x.won || y.setRatio - x.setRatio || y.ptRatio - x.ptRatio || x.team - y.team);
  }
  const allDone = () => state.fungame.matches.every((m) => m.done);

  // Format set
  $$('#set-format button').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.sets);
      if (!state.fungame || next === state.fungame.setFormat) return;
      const hasScores = state.fungame.matches.some((m) => m.sets.length);
      if (hasScores && !confirm(t('fungame.confirmFormat'))) return;
      state.fungame.setFormat = next;
      state.fungame.matches.forEach((m) => { m.sets = []; m.done = false; });
      state.showMatches = false;
      saveSession();
      renderers.fungame();
    })
  );
  $('#btn-reset-scores').addEventListener('click', () => {
    if (!state.fungame || !confirm(t('fungame.confirmReset'))) return;
    state.fungame = buildFungame(state.fungame.setFormat);
    state.showMatches = false;
    saveSession();
    renderers.fungame();
    cheer(t('fungame.resetDone'));
  });
  $('#btn-toggle-matches').addEventListener('click', () => {
    state.showMatches = !state.showMatches;
    renderers.fungame();
  });

  renderers.fungame = () => {
    if (!state.result) { foul(t('shuffle.notYet')); return goTo('shuffle'); }
    if (!state.fungame) state.fungame = buildFungame(1);
    const { setFormat, matches } = state.fungame;
    const finished = allDone();

    $('#fungame-kicker').textContent = t('fungame.kicker');
    $$('#set-format button').forEach((b) => {
      const on = Number(b.dataset.sets) === setFormat;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
    });

    // Header
    const done = matches.filter((m) => m.done).length;
    if (finished) {
      $('#fungame-title').textContent = t('fungame.titleDone');
      $('#fungame-sub').textContent = t('fungame.subDone', { team: state.teams[computeStandings()[0].team].name });
    } else {
      $('#fungame-title').textContent = t('fungame.title', { done, total: matches.length });
      $('#fungame-sub').textContent = t('fungame.sub', { fmt: t(`fungame.fmt${setFormat}`) });
    }

    // Hasil akhir
    const finalBox = $('#final');
    finalBox.hidden = !finished;
    if (finished) {
      $('#final-session').textContent = state.sessionTitle;
      $('#final-community').textContent = state.community;
      $('#final-meta').textContent = t('final.meta', {
        teams: state.teamCount, players: state.mode, matches: matches.length,
        date: new Date().toLocaleDateString(t('locale'), { dateStyle: 'long' }),
      });
      renderPodium(computeStandings().map((r) => r.team));
    }

    // Klasemen + aturan
    renderStandings();
    $('#rules-note').textContent = `${t(`fungame.rules${setFormat}`)} ${t('fungame.rulesOrder')}`;

    // Laga belum tersimpan
    const pendingBar = $('#pending-bar');
    const pending = matches.filter((m) => !m.done);
    pendingBar.hidden = finished || !pending.length;
    if (!pendingBar.hidden) {
      pendingBar.replaceChildren(
        el('span', { html: t('fungame.pending', { list: pending.map(matchLabel).join('</strong>, <strong>') }) }),
        el('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', text: t('fungame.seeMatch'),
          onclick: () => {
            const card = $(`.match[data-match="${pending[0].id}"]`);
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('is-focus');
            setTimeout(() => card.classList.remove('is-focus'), 1600);
          },
        })
      );
    }

    // Daftar laga: disembunyikan saat hasil akhir keluar, bisa dibuka lewat toggle
    const showList = !finished || state.showMatches;
    const toggle = $('#btn-toggle-matches');
    toggle.hidden = !finished;
    toggle.textContent = state.showMatches ? t('fungame.hideMatches') : t('fungame.showMatches');
    $('#matches-head').classList.toggle('matches-head--collapsed', finished && !state.showMatches);
    $('#matches-head .section-label').hidden = finished && !state.showMatches;
    const wrap = $('#bracket');
    wrap.hidden = !showList;
    wrap.innerHTML = '';
    if (showList) {
      const rounds = [...new Set(matches.map((m) => m.round))];
      rounds.forEach((round) => {
        const col = el('div', { class: 'round' }, [el('p', { class: 'round__title', text: roundLabel({ round }) })]);
        matches.filter((m) => m.round === round).forEach((m) => col.appendChild(renderMatch(m)));
        wrap.appendChild(col);
      });
    }
  };

  function renderMatch(m) {
    const teamA = state.teams[m.a], teamB = state.teams[m.b];
    const editable = !m.done;
    const sets = m.sets.length ? m.sets : [{ a: null, b: null }];
    const won = m.done ? setsWon(m) : null;
    const hasDraft = !m.done && m.sets.some((s) => s.a !== null || s.b !== null);
    const card = el('div', { class: `match card${m.done ? ' is-done' : ''}`, 'data-match': m.id });

    const status = m.done ? t('match.status.done') : hasDraft ? t('match.status.draft') : t('match.status.waiting');
    card.appendChild(el('div', { class: 'match__head' }, [
      el('span', { text: matchLabel(m) }),
      el('span', { class: `match__status${hasDraft ? ' match__status--draft' : ''}`, text: status }),
    ]));

    const board = el('div', { class: `scoreboard${won ? ' has-total' : ''}` });
    board.style.setProperty('--set-cols', sets.length);
    board.appendChild(el('span', { class: 'sb__corner', text: t('match.team') }));
    sets.forEach((_, i) => {
      const head = el('span', { class: 'sb__head', text: t('match.set', { n: i + 1 }) });
      if (editable && sets.length > 1 && i === sets.length - 1) {
        head.appendChild(el('button', {
          type: 'button', class: 'sb__remove', 'aria-label': t('match.removeSet', { n: i + 1 }), text: '✕',
          onclick: () => { readSets(m, card); m.sets.pop(); card.replaceWith(renderMatch(m)); },
        }));
      }
      board.appendChild(head);
    });
    if (won) board.appendChild(el('span', { class: 'sb__head sb__head--total', text: t('match.setTotal') }));

    ['a', 'b'].forEach((side) => {
      const team = side === 'a' ? teamA : teamB;
      const teamIdx = m[side];
      const isWinner = won && winnerOf(m) === teamIdx;
      board.appendChild(el('span', { class: `sb__team${isWinner ? ' is-winner' : ''}` }, [badge(team), el('span', { class: 'match-team__name', text: team.name })]));
      sets.forEach((s, i) => {
        const input = el('input', {
          type: 'number', min: '0', max: '99', inputmode: 'numeric', class: 'set-score',
          'data-set': i, 'data-side': side, placeholder: '–', value: s[side] ?? '',
          'aria-label': t('match.scoreAria', { n: i + 1, team: team.name }),
          disabled: editable ? null : 'true',
          onkeydown: (e) => { if (e.key === 'Enter') saveMatch(m, card); },
          oninput: () => {
            readSets(m, card);
            const st = $('.match__status', card);
            st.textContent = t('match.status.draft');
            st.classList.add('match__status--draft');
          },
        });
        if (m.done && s.a !== s.b) input.classList.add(s[side] > s[side === 'a' ? 'b' : 'a'] ? 'is-win' : 'is-lose');
        board.appendChild(input);
      });
      if (won) board.appendChild(el('span', { class: `sb__total${isWinner ? ' is-winner' : ''}`, text: won[side] }));
    });
    card.appendChild(board);

    const foot = el('div', { class: 'match__foot' });
    if (m.done) {
      const p = pointsTotal(m);
      foot.appendChild(el('span', { class: 'match__summary', text: t('match.summary', { sa: won.a, sb: won.b, pa: p.a, pb: p.b }) }));
      foot.appendChild(el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: t('match.edit'), onclick: () => { m.done = false; saveSession(); renderers.fungame(); } }));
    } else {
      if (sets.length < state.fungame.setFormat) {
        foot.appendChild(el('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', text: t('match.addSet'),
          onclick: () => { readSets(m, card); m.sets.push({ a: null, b: null }); card.replaceWith(renderMatch(m)); },
        }));
      } else foot.appendChild(el('span'));
      foot.appendChild(el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: t('match.save'), onclick: () => saveMatch(m, card) }));
    }
    card.appendChild(foot);
    return card;
  }

  function readSets(m, card) {
    const count = $$('.set-score[data-side="a"]', card).length;
    const read = (i, side) => { const v = $(`.set-score[data-set="${i}"][data-side="${side}"]`, card).value; return v === '' ? null : Number(v); };
    m.sets = Array.from({ length: count }, (_, i) => ({ a: read(i, 'a'), b: read(i, 'b') }));
  }

  function saveMatch(m, card) {
    readSets(m, card);
    const need = setsNeeded();
    const bad = (msg) => { shake(card); foul(msg); };
    for (const [i, s] of m.sets.entries()) {
      if (!Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a < 0 || s.b < 0) return bad(t('match.errIncomplete', { n: i + 1 }));
      if (s.a === s.b) return bad(t('match.errTie', { n: i + 1 }));
    }
    const w = setsWon(m);
    if (Math.max(w.a, w.b) < need) return bad(t('match.errNotEnough', { n: need }));
    if (Math.max(w.a, w.b) > need || Math.min(w.a, w.b) >= need) return bad(t('match.errTooMany', { n: need }));
    const last = m.sets[m.sets.length - 1];
    if (w[last.a > last.b ? 'a' : 'b'] !== need) return bad(t('match.errLastSet'));

    m.done = true;
    saveSession();
    renderers.fungame();
    if (allDone()) {
      cheer(t('match.champion', { team: state.teams[computeStandings()[0].team].name }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const hi = Math.max(w.a, w.b), lo = Math.min(w.a, w.b);
      cheer(t('match.won', { team: state.teams[winnerOf(m)].name, score: `${hi}-${lo}`, match: matchLabel(m) }));
    }
  }

  function renderStandings() {
    const rows = computeStandings();
    const finished = allDone();
    const th = (key) => `<th title="${t('table.t.' + key) || ''}">${t('table.' + key)}</th>`;
    const table = el('table', {}, [
      el('thead', {}, [el('tr', { html: `<th>${t('table.rank')}</th><th>${t('table.team')}</th>${['played', 'won', 'lost', 'pts', 'sets', 'setRatio', 'points', 'ptRatio'].map(th).join('')}` })]),
    ]);
    const tbody = el('tbody');
    rows.forEach((r, i) => {
      const team = state.teams[r.team];
      const tr = el('tr', { class: `${i === 0 && r.played > 0 ? 'is-leader' : ''}${finished && i === 0 ? ' is-champion' : ''}` }, [
        el('td', { class: 'rank', text: i + 1 }),
        el('td', {}, [el('span', { class: 'team-cell' }, [badge(team), el('span', { text: team.name })])]),
        el('td', { text: r.played }),
        el('td', { class: 'cell-win', text: r.won }),
        el('td', { class: 'cell-lose', text: r.lost }),
        el('td', { class: 'cell-pts', text: r.pts }),
        el('td', { text: `${r.setW}-${r.setL}` }),
        el('td', { class: 'cell-ratio', text: fmtRatio(r.setRatio) }),
        el('td', { class: 'cell-points', text: `${r.pf}-${r.pa}` }),
        el('td', { class: 'cell-ratio', text: fmtRatio(r.ptRatio) }),
      ]);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    $('#standings').replaceChildren(table);
  }

  function renderPodium(ranking) {
    const MEDALS = ['🥇', '🥈', '🥉', '🏐'];
    const standings = computeStandings();
    const podium = $('#podium');
    podium.innerHTML = '';
    ranking.forEach((teamIdx, i) => {
      const team = state.teams[teamIdx];
      const roster = state.result[teamIdx];
      const r = standings.find((s) => s.team === teamIdx);
      const name = el('span', { class: 'podium-card__name', text: team.name });
      name.style.background = team.color;
      const list = el('ul', { class: 'podium-card__roster' });
      POCKETS.forEach((p) => list.appendChild(el('li', { class: p.id === 'S' ? 'is-setter' : '', text: `${shortLabel(p)} ${roster[p.id]}` })));
      podium.appendChild(el('div', { class: `podium-card card podium-card--${i + 1}` }, [
        el('div', { class: 'podium-card__medal', text: MEDALS[i] }),
        el('div', { class: 'podium-card__rank', text: t(`final.rank${i + 1}`) }),
        name,
        el('div', { class: 'podium-card__stat', text: t('final.stat', { pts: r.pts, w: r.won, l: r.lost, sw: r.setW, sl: r.setL, pf: r.pf, pa: r.pa }) }),
        list,
      ]));
    });
  }

  // ---------- Start ----------
  applyStaticI18n();
  goTo('home');
})();
