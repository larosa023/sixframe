/* Sixframe — daily frame guessing (movies, shows, games)
 * Static site: everything runs in the browser. Day boundaries follow America/New_York.
 */
(() => {
  "use strict";

  const TZ = "America/New_York";
  const MAX_TRIES = 6;
  const ARCHIVE_DAYS = 101;
  const CATS = {
    movies: { label: "Movies", emoji: "🎬", noun: "movie", link: "IMDb" },
    shows:  { label: "Shows",  emoji: "📺", noun: "show",  link: "TMDB" },
    games:  { label: "Games",  emoji: "🎮", noun: "game",  link: "Steam" },
  };
  const WIN_WORDS = ["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"];

  let DATA = null;
  let FETCHED = {};
  let todayNum = 0;
  let route = { view: "", day: null };
  let game = null; // controller for the puzzle on screen
  const app = document.getElementById("app");
  const $ = (sel, el = document) => el.querySelector(sel);

  /* ---------- Storage + settings ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const settings = Object.assign({ hard: false, cb: false }, store.get("sf:settings", {}));
  const saveSettings = () => { store.set("sf:settings", settings); applySettings(); };
  function applySettings() { document.documentElement.classList.toggle("cb", !!settings.cb); }
  applySettings();

  /* ---------- Eastern-time date helpers ---------- */
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  function etParts(ts = Date.now()) {
    const p = {};
    for (const { type, value } of fmt.formatToParts(new Date(ts))) p[type] = +value || value;
    return p;
  }
  function etKey(ts = Date.now()) {
    const p = etParts(ts);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }
  const keyToUTC = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const dayNumFor = (key) => Math.round((keyToUTC(key) - keyToUTC(DATA.start)) / 864e5) + 1;
  const keyForDay = (n) => new Date(keyToUTC(DATA.start) + (n - 1) * 864e5).toISOString().slice(0, 10);
  const prettyDate = (key, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) =>
    new Date(keyToUTC(key)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  // Exact ms until the next Eastern midnight (handles DST switch days).
  function msToNextMidnight() {
    const now = Date.now();
    const p = etParts(now);
    const today = etKey(now);
    let target = now + (86400 - (p.hour * 3600 + p.minute * 60 + p.second)) * 1000;
    if (etKey(target) === today) target += 3600e3;
    else if (etKey(target - 3600e3) !== today) target -= 3600e3;
    return Math.max(0, target - now);
  }
  const hms = (ms) => { const s = Math.floor(ms / 1000); return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":"); };
  const firstDay = () => Math.max(1, todayNum - ARCHIVE_DAYS + 1);

  /* ---------- Puzzles + frames ---------- */
  const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const idOf = (p) => p.id || slug(p.answer);
  const rotating = (cat) => DATA[cat].puzzles.filter((p) => !p.date);

  function puzzleFor(cat, day) {
    const key = keyForDay(day);
    const pinned = DATA[cat].puzzles.find((p) => p.date === key);
    if (pinned) return pinned;
    const list = rotating(cat);
    return list[(day - 1) % list.length];
  }
  const metaFor = (cat, p) => { const e = (FETCHED[cat] || {})[idOf(p)]; return e && !Array.isArray(e) ? e : {}; };
  function framesFor(cat, p) {
    if (p.frames) return p.frames;
    const e = (FETCHED[cat] || {})[idOf(p)];
    const remote = Array.isArray(e) ? e : (e && e.frames) || [];
    return Array.from({ length: MAX_TRIES }, (_, i) => remote[i] || `frames/${cat}/${idOf(p)}/${i + 1}.${p.ext || DATA.ext || "jpg"}`);
  }
  const thumbOf = (u) => u.replace("/t/p/w1280/", "/t/p/w300/").replace(".1920x1080.jpg", ".600x338.jpg");
  function linkFor(cat, p) {
    const m = metaFor(cat, p);
    if (m.link) return m.link;
    if (cat === "movies" && p.imdb) return `https://www.imdb.com/title/${p.imdb}/`;
    if (cat === "games" && p.steam) return `https://store.steampowered.com/app/${p.steam}/`;
    return null;
  }

  /* ---------- Title search ---------- */
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9 ]+/g, " ").replace(/^(the|a|an) /, "").replace(/\s+/g, " ").trim();
  const compact = (s) => norm(s).replace(/ /g, "");

  const indexCache = {};
  function titleIndex(cat) {
    if (indexCache[cat]) return indexCache[cat];
    const entries = [];
    const count = {};
    for (const p of DATA[cat].puzzles) count[p.answer] = (count[p.answer] || 0) + 1;
    const seen = new Set();
    for (const p of DATA[cat].puzzles) {
      const id = `${p.answer}|${count[p.answer] > 1 ? p.year : ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({
        title: p.answer, year: p.year,
        label: count[p.answer] > 1 ? `${p.answer} (${p.year})` : p.answer,
        keys: [p.answer, ...(p.aliases || [])].map((t, i) => ({ text: t, n: norm(t), c: compact(t), alias: i > 0 })),
      });
    }
    for (const t of DATA[cat].pool || []) {
      if (entries.some((e) => norm(e.title) === norm(t))) continue;
      entries.push({ title: t, label: t, keys: [{ text: t, n: norm(t), c: compact(t), alias: false }] });
    }
    return (indexCache[cat] = entries);
  }

  function lev(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  function searchTitles(cat, query, exclude) {
    const q = norm(query), qc = compact(query);
    if (!qc) return [];
    const scored = [];
    for (const e of titleIndex(cat)) {
      if (exclude.has(e.label)) continue;
      let best = 0, via = null;
      for (const k of e.keys) {
        let s = 0;
        if (k.n === q || k.c === qc) s = 100;
        else if (k.n.startsWith(q) || k.c.startsWith(qc)) s = 90;
        else if ((" " + k.n).includes(" " + q)) s = 75;
        else if (k.n.includes(q)) s = 60;
        else if (qc.length >= 3 && k.c.includes(qc)) s = 50;
        if (k.alias) s -= 3;
        if (s > best) { best = s; via = k.alias ? k.text : null; }
      }
      if (best > 0) scored.push({ e, s: best, via });
    }
    // Typo-tolerant fallback ("shawshenk", "skyrm") when there are few direct matches.
    if (scored.length < 3 && qc.length >= 4) {
      const allowed = qc.length >= 8 ? 2 : 1;
      for (const e of titleIndex(cat)) {
        if (exclude.has(e.label) || scored.some((x) => x.e === e)) continue;
        let d = Infinity;
        for (const k of e.keys) {
          for (let len = qc.length - 1; len <= qc.length + 1; len++) d = Math.min(d, lev(qc, k.c.slice(0, len)));
          for (const w of k.n.split(" ")) if (w.length >= 4) d = Math.min(d, lev(qc, w));
        }
        if (d <= allowed) scored.push({ e, s: 30 - d, via: null });
      }
    }
    scored.sort((a, b) => b.s - a.s || a.e.label.length - b.e.label.length || a.e.label.localeCompare(b.e.label));
    return scored.slice(0, 8);
  }

  const isCorrect = (entry, p) => entry.title === p.answer && (entry.year == null || entry.year === p.year);
  const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi)$/;
  const seriesKey = (title) => norm(title.split(/:| - /)[0]).split(" ")
    .filter((w) => w && !/^\d+$/.test(w) && !ROMAN.test(w) && w !== "part").join(" ");
  function isFranchise(cat, entry, p) {
    const a = seriesKey(entry.title), b = seriesKey(p.answer);
    if (a && b && (a === b || a.startsWith(b + " ") || b.startsWith(a + " "))) return true;
    const series = metaFor(cat, p).series;
    if (!series) return false;
    const other = DATA[cat].puzzles.find((x) => x.answer === entry.title);
    return !!other && metaFor(cat, other).series === series;
  }

  /* ---------- Progress ---------- */
  const stateKey = (cat, day) => `sf:${cat}:${day}`;
  const loadState = (cat, day) => store.get(stateKey(cat, day), { marks: [], guesses: [], done: false, won: false });
  const statsKey = (cat) => `sf:stats:${cat}`;
  const loadStats = (cat) => Object.assign({ played: 0, wins: 0, streak: 0, best: 0, last: 0, dist: [0, 0, 0, 0, 0, 0] }, store.get(statsKey(cat), {}));

  function currentStreak(cat) {
    let start = todayNum;
    const t = loadState(cat, todayNum);
    if (!t.done) start = todayNum - 1;
    let n = 0;
    for (let d = start; d >= 1; d--) {
      const s = loadState(cat, d);
      if (s.done && s.won && s.sameDay) n++; else break;
    }
    if (n) return n;
    const legacy = loadStats(cat); // results saved before per-day streak tracking
    return legacy.last >= todayNum - 1 ? legacy.streak : 0;
  }

  function recordResult(cat, day, won, tries) {
    const s = loadStats(cat);
    s.played++;
    if (won) { s.wins++; s.dist[tries - 1]++; }
    if (day === todayNum) {
      s.streak = won ? (s.last === day - 1 ? s.streak + 1 : 1) : 0;
      if (won) s.last = day;
    }
    store.set(statsKey(cat), s);
    s.best = Math.max(s.best, currentStreak(cat));
    store.set(statsKey(cat), s);
  }

  const scoreText = (st) => (st.won ? `${st.marks.length}/6` : "X/6");
  const statusOf = (st) => (st.done ? (st.won ? "won" : "lost") : st.marks.length ? "playing" : "new");

  /* ---------- UI helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }
  const square = (m) => ({ win: settings.cb ? "🟦" : "🟩", miss: "🟥", close: "🟨", skip: "⬛" }[m]);
  const squares = (st) => st.marks.map(square).join("") + "⬜".repeat(MAX_TRIES - st.marks.length);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTyping = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  const anyDialogOpen = () => !!document.querySelector("dialog[open]");
  const siteUrl = () => `${location.origin}${location.pathname}`;

  async function shareOut(text) {
    try {
      if (navigator.share && matchMedia("(pointer:coarse)").matches) { await navigator.share({ text }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast("Copied — paste it anywhere"); return; } catch { /* fall through */ }
    const dlg = $("#copyDlg"), ta = $("#copyText");
    ta.value = text; dlg.showModal(); ta.select();
  }

  function confetti() {
    if (reduceMotion()) return;
    const box = document.createElement("div");
    box.className = "confetti";
    const colors = ["#ff6b5b", "#5bb8ff", "#7ce38b", "#ffb547", "#c792ea"];
    for (let i = 0; i < 70; i++) {
      const s = document.createElement("i");
      s.style.left = Math.random() * 100 + "%";
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = Math.random() * 0.3 + "s";
      s.style.animationDuration = 1.6 + Math.random() * 1.2 + "s";
      s.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3500);
  }

  /* ---------- Tabs ---------- */
  function updateTabs() {
    for (const a of document.querySelectorAll("#tabs a")) {
      const cat = a.dataset.cat;
      a.classList.toggle("active", cat === route.view);
      if (cat === "archive") continue;
      const st = loadState(cat, todayNum);
      const b = a.querySelector(".tab-badge");
      const status = statusOf(st);
      b.className = `tab-badge ${status}`;
      b.textContent = status === "won" ? scoreText(st) : status === "lost" ? "✗" : status === "playing" ? "…" : "";
      a.title = status === "new" ? `Today's ${CATS[cat].noun}` : `Today: ${status === "playing" ? "in progress" : scoreText(st)}`;
    }
  }

  function shareTodayText() {
    const lines = [`Sixframe #${todayNum} · ${prettyDate(keyForDay(todayNum), { month: "short", day: "numeric" })}${settings.hard ? " 🔥" : ""}`];
    for (const c of Object.keys(CATS)) {
      const st = loadState(c, todayNum);
      if (st.done) lines.push(`${CATS[c].emoji} ${scoreText(st)} ${st.marks.map(square).join("")}`);
    }
    lines.push(siteUrl());
    return lines.join("\n");
  }

  /* ---------- Game view ---------- */
  function renderGame(cat, day) {
    const puzzle = puzzleFor(cat, day);
    const frames = framesFor(cat, puzzle);
    const meta = metaFor(cat, puzzle);
    const hints = settings.hard ? [] : meta.hints || [];
    const st = loadState(cat, day);
    const isToday = day === todayNum;
    let viewing = st.done ? MAX_TRIES - 1 : Math.min(st.marks.length, MAX_TRIES - 1);
    let giveUpArmed = 0;

    // Repeats: the rotation loops once every list length; say so if they played the earlier run.
    const loop = rotating(cat).length;
    const prevRun = !puzzle.date && day > loop ? day - loop : 0;
    const prevState = prevRun ? loadState(cat, prevRun) : null;

    document.title = `Sixframe · ${CATS[cat].label} #${day}`;
    app.className = `game cat-${cat}`;
    app.innerHTML = `
      <div class="puzzle-head">
        <h1>${CATS[cat].emoji} ${CATS[cat].label} <span>#${day}</span></h1>
        <span class="date">${prettyDate(keyForDay(day))}${isToday ? " · Today" : ""}</span>
        ${settings.hard ? '<span class="pill hard" title="Hints are off (Settings)">🔥 Hard mode</span>' : ""}
      </div>
      ${prevState && prevState.marks.length ? `<p class="note">You played this one before, as #${prevRun} on ${prettyDate(keyForDay(prevRun), { month: "short", day: "numeric" })}.</p>` : ""}
      <div class="stage" id="stage" tabindex="-1">
        <div class="stage-bg" id="stageBg"></div>
        <img id="frameImg" alt="">
        <div class="spinner" id="spinner"></div>
        <div class="ph" id="ph" hidden></div>
        <span class="badge" id="badge"></span>
        <button class="stage-nav prev" id="prevBtn" aria-label="Previous frame">‹</button>
        <button class="stage-nav next" id="nextBtn" aria-label="Next frame">›</button>
        <button class="expand" id="expandBtn" aria-label="View full screen" title="Full screen">⤢</button>
      </div>
      <div class="frames" id="frameBtns" role="tablist" aria-label="Frames"></div>
      <div class="remaining" id="remaining" aria-live="polite"></div>
      <div id="controls"></div>
      <ul class="history" id="history" aria-label="Your guesses"></ul>
      <div id="hints"></div>
      <div id="result"></div>
      <div class="day-nav">
        ${day > firstDay() ? `<a class="btn small ghost" href="#/${cat}/${day - 1}">◀ #${day - 1}</a>` : "<span></span>"}
        <a class="btn small ghost" href="#/archive">🗂 Archive</a>
        ${day < todayNum ? `<a class="btn small ghost" href="#/${cat}/${day + 1}">#${day + 1} ▶</a>` : "<span></span>"}
      </div>`;

    const stage = $("#stage"), img = $("#frameImg"), bg = $("#stageBg"), spinner = $("#spinner"), ph = $("#ph");
    const badge = $("#badge"), frameBtns = $("#frameBtns"), controls = $("#controls");
    const history = $("#history"), hintsBox = $("#hints"), result = $("#result"), remainingEl = $("#remaining");
    const unlocked = () => (st.done ? MAX_TRIES : Math.min(st.marks.length + 1, MAX_TRIES));
    const preload = (u) => { if (u) { const i = new Image(); i.src = u; } };

    function showFrame(i) {
      i = Math.max(0, Math.min(i, unlocked() - 1));
      viewing = i;
      badge.textContent = `Frame ${i + 1} / ${MAX_TRIES}`;
      ph.hidden = true;
      img.classList.remove("loaded");
      spinner.hidden = false;
      bg.style.backgroundImage = `url("${thumbOf(frames[i])}")`;
      img.onload = () => { img.classList.add("loaded"); spinner.hidden = true; };
      img.onerror = () => {
        spinner.hidden = true;
        ph.hidden = false;
        ph.innerHTML = `<div><b>${i + 1}</b>This frame didn't load.<br><button class="btn small" id="retryImg">Try again</button></div>`;
        $("#retryImg").onclick = () => { img.src = ""; showFrame(i); };
      };
      img.alt = `${CATS[cat].label} #${day}, frame ${i + 1}`;
      img.src = frames[i];
      if (img.complete && img.naturalWidth) img.onload();
      preload(frames[i + 1] && i + 1 < unlocked() ? frames[i + 1] : null);
      $("#prevBtn").hidden = i === 0;
      $("#nextBtn").hidden = i >= unlocked() - 1;
      drawFrameBtns();
      if (lightbox.isOpen) lightbox.show(i);
    }

    function drawFrameBtns() {
      frameBtns.innerHTML = "";
      for (let i = 0; i < MAX_TRIES; i++) {
        const b = document.createElement("button");
        const mark = st.marks[i];
        const open = i < unlocked();
        b.className = `thumb ${mark || ""} ${i === viewing ? "sel" : ""} ${open ? "" : "locked"}`;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", i === viewing);
        b.setAttribute("aria-label", open ? `Frame ${i + 1}${mark ? ", " + { win: "correct", miss: "wrong guess", close: "right franchise", skip: "skipped" }[mark] : ""}` : `Frame ${i + 1}, locked`);
        b.innerHTML = `<span>${open ? i + 1 : "🔒"}</span>`;
        if (open) b.style.backgroundImage = `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url("${thumbOf(frames[i])}")`;
        b.disabled = !open;
        b.onclick = () => showFrame(i);
        frameBtns.appendChild(b);
      }
      const left = MAX_TRIES - st.marks.length;
      remainingEl.textContent = st.done ? "" : `${left} guess${left === 1 ? "" : "es"} left${hints.length ? ` · ${Math.min(st.marks.length, hints.length)}/${hints.length} hints` : ""}`;
    }

    function drawHints() {
      if (!hints.length) { hintsBox.innerHTML = ""; return; }
      const shown = st.done ? hints.length : Math.min(st.marks.length, hints.length);
      hintsBox.innerHTML = `<div class="hints"><h3>Hints</h3>${hints.map(([label, value], i) => i < shown
        ? `<div class="hint ${i === shown - 1 && !st.done ? "fresh" : ""}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
        : `<div class="hint locked"><span>${esc(label)}</span><i>🔒 after guess ${i + 1}</i></div>`).join("")}</div>`;
    }

    function drawHistory() {
      history.innerHTML = st.guesses.map((g, i) =>
        `<li class="${st.marks[i]}"><span class="sq">${square(st.marks[i])}</span> ${st.marks[i] === "skip" ? "<em>Skipped</em>" : esc(g)}${st.marks[i] === "close" ? ' <small>right franchise</small>' : ""}</li>`).join("");
    }

    function drawResult() {
      if (!st.done) { result.innerHTML = ""; return; }
      const link = linkFor(cat, puzzle);
      const nextCat = Object.keys(CATS).find((c) => c !== cat && !loadState(c, todayNum).done);
      const allTodayDone = Object.keys(CATS).every((c) => loadState(c, todayNum).done);
      result.innerHTML = `
        <div class="result ${st.won ? "won" : "lost"}">
          <h2>${st.won ? WIN_WORDS[st.marks.length - 1] : "Out of frames"}</h2>
          <div class="muted">${st.won ? `Solved in ${st.marks.length} of 6` : "The answer was"}</div>
          <div class="answer">${esc(puzzle.answer)}${puzzle.year ? ` <span>(${puzzle.year})</span>` : ""}</div>
          ${link ? `<a class="ext" href="${esc(link)}" target="_blank" rel="noopener">View on ${CATS[cat].link} ↗</a>` : ""}
          <div class="squares" aria-label="Your result">${squares(st)}</div>
          ${isToday ? `<div class="next-in">Next ${CATS[cat].noun} in <b id="resultCountdown">${hms(msToNextMidnight())}</b></div>` : ""}
          <div class="actions">
            <button class="btn primary" id="shareBtn">📋 Share</button>
            ${isToday && nextCat ? `<a class="btn" href="#/${nextCat}">Next: ${CATS[nextCat].emoji} ${CATS[nextCat].label}</a>` : ""}
            ${isToday && allTodayDone ? `<button class="btn" id="shareAllBtn">Share all 3</button>` : ""}
            <button class="btn" id="randomBtn">🎲 Random unplayed</button>
          </div>
        </div>`;
      $("#shareBtn").onclick = () => shareOut(
        `Sixframe ${CATS[cat].emoji} ${CATS[cat].label} #${day} ${scoreText(st)}${settings.hard ? " 🔥" : ""}\n${squares(st)}\n${siteUrl()}#/${cat}/${day}`);
      const sa = $("#shareAllBtn"); if (sa) sa.onclick = () => shareOut(shareTodayText());
      $("#randomBtn").onclick = () => goRandom(cat);
    }

    function drawControls() {
      if (st.done) { controls.innerHTML = ""; return; }
      controls.innerHTML = `
        <div class="guess-row">
          <div class="input-wrap">
            <input id="guess" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
              placeholder="Type a ${CATS[cat].noun} title…" aria-label="Your guess" role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list">
            <button class="clear" id="clearBtn" aria-label="Clear" hidden>✕</button>
            <ul class="suggest" id="suggest" role="listbox" hidden></ul>
          </div>
          <button class="btn primary" id="goBtn">Guess</button>
          <button class="btn skip" id="skipBtn"></button>
        </div>
        <p class="kbd-tip">Tip: <kbd>←</kbd> <kbd>→</kbd> flip frames · <kbd>1</kbd>–<kbd>6</kbd> jump · start typing to guess</p>`;
      const input = $("#guess"), sug = $("#suggest"), clearBtn = $("#clearBtn");
      let hl = -1, items = [];

      const close = () => { sug.hidden = true; input.setAttribute("aria-expanded", "false"); };
      function update() {
        clearBtn.hidden = !input.value;
        const exclude = new Set(st.guesses);
        items = input.value.trim() ? searchTitles(cat, input.value, exclude) : [];
        hl = items.length ? 0 : -1;
        if (!input.value.trim()) { close(); return; }
        sug.innerHTML = items.length
          ? items.map((r, i) => `<li role="option" id="opt${i}" class="${i === hl ? "hl" : ""}" data-i="${i}">${esc(r.e.label)}${r.via ? `<small>${esc(r.via)}</small>` : ""}</li>`).join("")
          : `<li class="empty">No matching ${CATS[cat].noun}. Try another spelling.</li>`;
        sug.hidden = false;
        input.setAttribute("aria-expanded", "true");
        for (const li of sug.querySelectorAll("li[data-i]")) {
          li.onmousedown = (e) => { e.preventDefault(); choose(items[+li.dataset.i].e); };
        }
      }
      function highlight(n) {
        if (!items.length) return;
        hl = (n + items.length) % items.length;
        sug.querySelectorAll("li[data-i]").forEach((li, i) => li.classList.toggle("hl", i === hl));
        const el = sug.querySelector(".hl"); if (el) el.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", `opt${hl}`);
      }
      function submitTyped() {
        const text = input.value.trim();
        if (!text) { input.focus(); toast(`Type a ${CATS[cat].noun} title first`); return; }
        if (hl >= 0 && items[hl] && !sug.hidden) return choose(items[hl].e);
        const exact = titleIndex(cat).find((e) => e.keys.some((k) => k.n === norm(text) || k.c === compact(text)));
        if (exact) return choose(exact);
        if (items.length === 1) return choose(items[0].e);
        toast(items.length ? "Pick a title from the list" : `That ${CATS[cat].noun} isn't in the list`);
      }
      function choose(entry) {
        if (st.guesses.includes(entry.label)) { toast("Already guessed that one"); return; }
        const keepFocus = document.activeElement === input;
        input.value = ""; clearBtn.hidden = true; close();
        advance(isCorrect(entry, puzzle) ? "win" : isFranchise(cat, entry, puzzle) ? "close" : "miss", entry.label);
        if (keepFocus && !st.done) input.focus();
      }

      input.addEventListener("input", update);
      input.addEventListener("focus", () => { if (input.value) update(); });
      input.addEventListener("blur", () => setTimeout(close, 120));
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); if (sug.hidden && input.value) update(); else highlight(hl + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); highlight(hl - 1); }
        else if (e.key === "Enter") { e.preventDefault(); submitTyped(); }
        else if (e.key === "Escape") { if (!sug.hidden) { e.stopPropagation(); close(); } else input.blur(); }
        else if (e.key === "Tab" && !sug.hidden && items[hl]) { e.preventDefault(); input.value = items[hl].e.label; update(); }
      });
      clearBtn.onclick = () => { input.value = ""; update(); input.focus(); };
      $("#goBtn").onclick = submitTyped;
      $("#skipBtn").onclick = () => {
        const last = st.marks.length === MAX_TRIES - 1;
        if (last && Date.now() - giveUpArmed > 3000) {
          giveUpArmed = Date.now();
          $("#skipBtn").textContent = "Sure? Tap again";
          setTimeout(drawSkip, 3000);
          return;
        }
        advance("skip", "");
      };
      drawSkip();
      if (matchMedia("(pointer:fine)").matches) input.focus({ preventScroll: true });
    }
    function drawSkip() {
      const b = $("#skipBtn"); if (!b) return;
      b.textContent = st.marks.length === MAX_TRIES - 1 ? "Give up" : "Skip ⏩";
      b.title = st.marks.length === MAX_TRIES - 1 ? "Reveal the answer" : "Skip to the next frame";
    }

    function advance(mark, guess) {
      st.marks.push(mark);
      st.guesses.push(guess);
      if (mark === "win") { st.done = true; st.won = true; }
      else if (st.marks.length >= MAX_TRIES) st.done = true;
      if (st.done) st.sameDay = day === todayNum;
      store.set(stateKey(cat, day), st);
      if (st.done) recordResult(cat, day, st.won, st.marks.length);

      if (mark === "win") { toast(WIN_WORDS[st.marks.length - 1]); confetti(); }
      else if (st.done) toast(`It was ${puzzle.answer}`, 3000);
      else {
        const hintMsg = hints.length && st.marks.length <= hints.length ? " · new hint" : "";
        toast((mark === "skip" ? "Skipped" : mark === "close" ? "Right franchise, wrong title" : "Not quite") + ` · frame ${st.marks.length + 1} unlocked${hintMsg}`);
        if (mark !== "skip" && !reduceMotion()) { stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); }
      }
      showFrame(st.done ? viewing : st.marks.length);
      drawHistory(); drawHints(); drawResult(); drawSkip(); updateTabs();
      if (st.done) {
        controls.innerHTML = "";
        setTimeout(() => result.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "nearest" }), 150);
      }
    }

    // Stage interactions: arrows, full screen, swipe.
    $("#prevBtn").onclick = (e) => { e.stopPropagation(); showFrame(viewing - 1); };
    $("#nextBtn").onclick = (e) => { e.stopPropagation(); showFrame(viewing + 1); };
    $("#expandBtn").onclick = (e) => { e.stopPropagation(); lightbox.open(frames, viewing, unlocked, showFrame); };
    stage.onclick = () => lightbox.open(frames, viewing, unlocked, showFrame);
    let tx = null, ty = null;
    stage.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      tx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); showFrame(viewing + (dx < 0 ? 1 : -1)); }
    });

    for (let i = 0; i < unlocked(); i++) preload(frames[i]);
    showFrame(viewing);
    drawControls(); drawHistory(); drawHints(); drawResult();

    return {
      cat, day,
      flip: (d) => showFrame(viewing + d),
      jump: (i) => showFrame(i),
      expand: () => lightbox.open(frames, viewing, unlocked, showFrame),
      input: () => $("#guess"),
      tick: () => { const el = $("#resultCountdown"); if (el) el.textContent = hms(msToNextMidnight()); },
    };
  }

  /* ---------- Full-screen viewer ---------- */
  const lightbox = (() => {
    const dlg = $("#lightbox"), im = $("#lbImg"), cap = $("#lbCap");
    let frames = [], idx = 0, unlockedFn = () => 1, onChange = () => {};
    function show(i) {
      idx = Math.max(0, Math.min(i, unlockedFn() - 1));
      im.src = frames[idx];
      cap.textContent = `Frame ${idx + 1} / ${MAX_TRIES}`;
      $("#lbPrev").disabled = idx === 0;
      $("#lbNext").disabled = idx >= unlockedFn() - 1;
    }
    $("#lbPrev").onclick = () => { show(idx - 1); onChange(idx); };
    $("#lbNext").onclick = () => { show(idx + 1); onChange(idx); };
    $("#lbClose").onclick = () => dlg.close();
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    let tx = null;
    dlg.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener("touchend", (e) => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 40) { show(idx + (dx < 0 ? 1 : -1)); onChange(idx); }
    });
    return {
      get isOpen() { return dlg.open; },
      open(f, i, u, cb) { frames = f; unlockedFn = u; onChange = cb; show(i); if (!dlg.open) dlg.showModal(); },
      show,
      step(d) { show(idx + d); onChange(idx); },
    };
  })();

  /* ---------- Random unplayed ---------- */
  function goRandom(prefer) {
    const cats = prefer ? [prefer, ...Object.keys(CATS).filter((c) => c !== prefer)] : Object.keys(CATS);
    for (const c of cats) {
      const open = [];
      for (let d = firstDay(); d <= todayNum; d++) if (!loadState(c, d).done && !(route.view === c && route.day === d)) open.push(d);
      if (open.length) { location.hash = `#/${c}/${open[Math.floor(Math.random() * open.length)]}`; return; }
    }
    toast("You've played every puzzle in the archive! 🎉", 3000);
  }

  /* ---------- Archive view ---------- */
  const archPrefs = Object.assign({ cat: "all", unplayed: false }, store.get("sf:archive", {}));
  function renderArchive() {
    document.title = "Sixframe · Archive";
    app.className = "archive";
    const first = firstDay();
    const total = todayNum - first + 1;
    const cats = Object.keys(CATS).filter((c) => archPrefs.cat === "all" || archPrefs.cat === c);
    const solved = {}, played = {};
    for (const c of Object.keys(CATS)) {
      solved[c] = 0; played[c] = 0;
      for (let d = first; d <= todayNum; d++) { const s = loadState(c, d); if (s.done) { played[c]++; if (s.won) solved[c]++; } }
    }
    const allSolved = Object.values(solved).reduce((a, b) => a + b, 0);
    const allPlayed = Object.values(played).reduce((a, b) => a + b, 0);

    let html = "", month = "";
    for (let d = todayNum; d >= first; d--) {
      const key = keyForDay(d);
      const states = cats.map((c) => [c, loadState(c, d)]);
      if (archPrefs.unplayed && states.every(([, s]) => s.done)) continue;
      const m = prettyDate(key, { month: "long", year: "numeric" });
      if (m !== month) { if (month) html += "</div>"; html += `<h2 class="month">${m}</h2><div class="arch-grid">`; month = m; }
      const chips = states.map(([c, s]) => {
        const status = statusOf(s);
        const txt = status === "won" ? scoreText(s) : status === "lost" ? "✗" : status === "playing" ? "…" : "";
        return `<a class="chip ${status}" href="#/${c}/${d}" title="${CATS[c].label} #${d}${txt ? " · " + txt : ""}">${CATS[c].emoji}<small>${txt}</small></a>`;
      }).join("");
      html += `<div class="arch-day ${d === todayNum ? "today" : ""}"><div class="n">#${d}${d === todayNum ? " <em>Today</em>" : ""}</div><div class="d">${prettyDate(key, { weekday: "short", month: "short", day: "numeric" })}</div><div class="links">${chips}</div></div>`;
    }
    if (month) html += "</div>";
    if (!html) html = `<p class="empty-state">🎉 Nothing left to play here. You've finished every puzzle${archPrefs.cat === "all" ? "" : " in this category"}!</p>`;

    app.innerHTML = `
      <div class="arch-head">
        <div>
          <h1>Archive</h1>
          <p class="muted">The last ${total} days. Every puzzle stays playable for ${ARCHIVE_DAYS} days.</p>
        </div>
        <button class="btn primary" id="randomBtn">🎲 Random unplayed</button>
      </div>
      <div class="progress-row">
        ${Object.keys(CATS).map((c) => `<div class="prog cat-${c}"><div class="prog-top"><span>${CATS[c].emoji} ${CATS[c].label}</span><b>${solved[c]}/${total}</b></div><div class="bar"><i style="width:${(played[c] / total) * 100}%"></i><i class="ok" style="width:${(solved[c] / total) * 100}%"></i></div></div>`).join("")}
      </div>
      <p class="muted small">${allSolved} solved · ${allPlayed - allSolved} missed · ${total * 3 - allPlayed} to go</p>
      <div class="arch-filter">
        ${["all", ...Object.keys(CATS)].map((f) => `<button class="btn small ${archPrefs.cat === f ? "active" : ""}" data-f="${f}">${f === "all" ? "All" : CATS[f].emoji + " " + CATS[f].label}</button>`).join("")}
        <label class="toggle"><input type="checkbox" id="unplayedOnly" ${archPrefs.unplayed ? "checked" : ""}> Unfinished only</label>
      </div>
      ${html}`;
    app.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { archPrefs.cat = b.dataset.f; store.set("sf:archive", archPrefs); renderArchive(); });
    $("#unplayedOnly").onchange = (e) => { archPrefs.unplayed = e.target.checked; store.set("sf:archive", archPrefs); renderArchive(); };
    $("#randomBtn").onclick = () => goRandom(archPrefs.cat === "all" ? null : archPrefs.cat);
  }

  /* ---------- Stats dialog ---------- */
  function renderStats() {
    const first = firstDay();
    const total = todayNum - first + 1;
    let gp = 0, gw = 0;
    const cards = Object.entries(CATS).map(([c, meta]) => {
      const s = loadStats(c);
      gp += s.played; gw += s.wins;
      const max = Math.max(1, ...s.dist);
      const avg = s.wins ? (s.dist.reduce((a, n, i) => a + n * (i + 1), 0) / s.wins).toFixed(1) : "–";
      const today = loadState(c, todayNum);
      let archiveSolved = 0;
      for (let d = first; d <= todayNum; d++) if (loadState(c, d).won) archiveSolved++;
      return `<div class="stat-cat cat-${c}">
        <h3>${meta.emoji} ${meta.label} <small>${archiveSolved}/${total} in archive</small></h3>
        <div class="stat-nums">
          <div><b>${s.played}</b><span>Played</span></div>
          <div><b>${s.played ? Math.round((s.wins / s.played) * 100) : 0}%</b><span>Win rate</span></div>
          <div><b>${currentStreak(c)}</b><span>Streak</span></div>
          <div><b>${s.best}</b><span>Best</span></div>
          <div><b>${avg}</b><span>Avg</span></div>
        </div>
        <div class="dist">${s.dist.map((n, i) => `<div class="${today.won && today.marks.length === i + 1 ? "now" : ""}"><span>${i + 1}</span><i style="width:${Math.max(6, (n / max) * 100)}%">${n}</i></div>`).join("")}</div>
      </div>`;
    }).join("");
    $("#statsBody").innerHTML = `
      <h2>Statistics</h2>
      <div class="stat-total"><div><b>${gp}</b><span>Played</span></div><div><b>${gp ? Math.round((gw / gp) * 100) : 0}%</b><span>Win rate</span></div><div><b>${gw}</b><span>Solved</span></div></div>
      ${cards}
      <p class="muted small">Streaks count puzzles solved on their own day. Archive plays count toward the other stats.</p>`;
    $("#statsDlg").showModal();
  }

  /* ---------- Settings dialog ---------- */
  function exportCode() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("sf:")) data[k] = localStorage.getItem(k); }
    return "SF1." + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  function importCode(code) {
    const raw = code.trim().replace(/^SF1\./, "");
    const data = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!data || typeof data !== "object") throw new Error("bad");
    let n = 0;
    for (const [k, v] of Object.entries(data)) if (k.startsWith("sf:") && typeof v === "string") { localStorage.setItem(k, v); n++; }
    return n;
  }
  function openSettings() {
    $("#setHard").checked = settings.hard;
    $("#setCb").checked = settings.cb;
    $("#backupOut").value = "";
    $("#backupIn").value = "";
    $("#settingsDlg").showModal();
  }
  function wireSettings() {
    $("#setHard").onchange = (e) => { settings.hard = e.target.checked; saveSettings(); rerender(); toast(settings.hard ? "Hard mode on: no hints" : "Hints are back on"); };
    $("#setCb").onchange = (e) => { settings.cb = e.target.checked; saveSettings(); rerender(); };
    $("#copyBackup").onclick = async () => {
      const code = exportCode();
      $("#backupOut").value = code;
      try { await navigator.clipboard.writeText(code); toast("Backup code copied"); } catch { $("#backupOut").select(); }
    };
    $("#restoreBackup").onclick = () => {
      try {
        const n = importCode($("#backupIn").value);
        Object.assign(settings, store.get("sf:settings", {})); applySettings();
        toast(`Restored ${n} saved items`); $("#settingsDlg").close(); rerender();
      } catch { toast("That code didn't work. Copy the whole thing and try again.", 3000); }
    };
    $("#resetAll").onclick = () => {
      if (!confirm("Erase all your Sixframe progress and stats on this device? This can't be undone.")) return;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("sf:") && k !== "sf:settings") keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
      toast("Progress erased"); $("#settingsDlg").close(); rerender();
    };
  }

  /* ---------- Router ---------- */
  function parseHash() {
    const [, view = "", day = ""] = location.hash.split("/");
    if (view === "archive") return { view, day: null };
    const cat = CATS[view] ? view : lastCat();
    let d = parseInt(day, 10);
    if (!d || d > todayNum || d < firstDay()) d = null;
    return { view: cat, day: d };
  }
  // With no category in the URL, open the first of today's puzzles you haven't finished.
  function lastCat() {
    const open = Object.keys(CATS).find((c) => !loadState(c, todayNum).done);
    return open || "movies";
  }
  function render() {
    const prev = route;
    route = parseHash();
    if (route.view === "archive") { game = null; renderArchive(); }
    else game = renderGame(route.view, route.day || todayNum);
    updateTabs();
    if (prev.view !== route.view || prev.day !== route.day) window.scrollTo(0, 0);
  }
  const rerender = () => { const y = scrollY; render(); scrollTo(0, y); };

  /* ---------- Keyboard ---------- */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("#lightbox").open) {
      if (e.key === "ArrowLeft") { e.preventDefault(); lightbox.step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); lightbox.step(1); }
      return;
    }
    if (anyDialogOpen() || !game) return;
    const input = game.input();
    if (isTyping(document.activeElement)) {
      if (document.activeElement === input && !input.value && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault(); game.flip(e.key === "ArrowLeft" ? -1 : 1);
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); game.flip(e.key === "ArrowLeft" ? -1 : 1); }
    else if (/^[1-6]$/.test(e.key)) game.jump(+e.key - 1);
    else if (input && (e.key === "/" || /^[a-zA-Z]$/.test(e.key))) {
      if (e.key === "/") e.preventDefault();
      input.focus();
    }
  }

  /* ---------- Live clock + midnight rollover ---------- */
  function tick() {
    $("#countdown").textContent = hms(msToNextMidnight());
    if (game) game.tick();
    const n = dayNumFor(etKey());
    if (n !== todayNum) {
      const wasToday = route.view !== "archive" && !route.day;
      todayNum = n;
      if (wasToday || route.view === "archive") render(); else updateTabs();
      toast("New puzzles are live!", 3000);
    }
  }

  /* ---------- Boot ---------- */
  async function boot() {
    try {
      const res = await fetch("data/puzzles.json", { cache: "no-cache" });
      DATA = await res.json();
      try {
        const fr = await fetch("data/frames.json", { cache: "no-cache" });
        if (fr.ok) FETCHED = await fr.json();
      } catch { /* no build-time frames yet */ }
    } catch (e) {
      app.innerHTML = `<p class="empty-state">Couldn't load today's puzzles. Check your connection and <a href="">reload</a>.</p>`;
      return;
    }
    todayNum = dayNumFor(etKey());
    if (todayNum < 1) { app.innerHTML = `<p class="empty-state">Sixframe launches on ${prettyDate(DATA.start)}. See you then!</p>`; return; }

    $("#statsBtn").onclick = renderStats;
    $("#helpBtn").onclick = () => $("#helpDlg").showModal();
    $("#settingsBtn").onclick = openSettings;
    for (const d of document.querySelectorAll("dialog")) {
      d.addEventListener("click", (e) => { if (e.target === d && d.id !== "lightbox") d.close(); });
    }
    wireSettings();
    if (!store.get("sf:seenHelp", false)) { store.set("sf:seenHelp", true); $("#helpDlg").showModal(); }
    window.addEventListener("hashchange", render);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    render();
    tick();
    setInterval(tick, 1000);
  }
  boot();
})();
