/* Sixframe — daily frame guessing (movies, shows, games)
 * Static site: everything runs in the browser. Day boundaries follow America/New_York.
 */
(() => {
  "use strict";

  const TZ = "America/New_York";
  const MAX_TRIES = 6;
  const ARCHIVE_DAYS = 100;
  const CATS = {
    movies: { label: "Movies", emoji: "🎬" },
    shows:  { label: "Shows",  emoji: "📺" },
    games:  { label: "Games",  emoji: "🎮" },
  };

  let DATA = null;
  let todayNum = 0;
  let route = { view: "movies", day: null };
  const app = document.getElementById("app");

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
  function keyForDay(n) {
    const d = new Date(keyToUTC(DATA.start) + (n - 1) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  function prettyDate(key) {
    return new Date(keyToUTC(key)).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  }
  // Exact ms until the next Eastern midnight (handles DST switch days).
  function msToNextMidnight() {
    const now = Date.now();
    const p = etParts(now);
    const today = etKey(now);
    let target = now + (86400 - (p.hour * 3600 + p.minute * 60 + p.second)) * 1000;
    if (etKey(target) === today) target += 3600e3;          // 25-hour day
    else if (etKey(target - 3600e3) !== today) target -= 3600e3; // 23-hour day
    return Math.max(0, target - now);
  }

  /* ---------- Puzzle selection ---------- */
  const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function puzzleFor(cat, day) {
    const list = DATA[cat].puzzles;
    // A puzzle can pin itself to a date with "date": "YYYY-MM-DD"; otherwise rotate.
    const key = keyForDay(day);
    const pinned = list.find((p) => p.date === key);
    if (pinned) return pinned;
    const rotating = list.filter((p) => !p.date);
    return rotating[(day - 1) % rotating.length];
  }
  function framesFor(cat, puzzle) {
    if (puzzle.frames) return puzzle.frames;
    const base = `frames/${cat}/${puzzle.id || slug(puzzle.answer)}`;
    const ext = puzzle.ext || DATA.ext || "jpg";
    return Array.from({ length: MAX_TRIES }, (_, i) => `${base}/${i + 1}.${ext}`);
  }

  /* ---------- Guess matching ---------- */
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9 ]+/g, " ").replace(/^(the|a|an) /, "").replace(/\s+/g, " ").trim();
  const isCorrect = (guess, p) => [p.answer, ...(p.aliases || [])].some((a) => norm(a) === norm(guess));

  function titlePool(cat) {
    const set = new Set([...DATA[cat].puzzles.map((p) => p.answer), ...(DATA[cat].pool || [])]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /* ---------- Storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const stateKey = (cat, day) => `sf:${cat}:${day}`;
  const loadState = (cat, day) => store.get(stateKey(cat, day), { marks: [], guesses: [], done: false, won: false });

  function recordResult(cat, day, won, tries) {
    const s = store.get(`sf:stats:${cat}`, { played: 0, wins: 0, streak: 0, best: 0, last: 0, dist: [0, 0, 0, 0, 0, 0] });
    s.played++;
    if (won) { s.wins++; s.dist[tries - 1]++; }
    // Streaks only count today's puzzle, played on the day.
    if (day === todayNum) {
      s.streak = won ? (s.last === day - 1 ? s.streak + 1 : 1) : 0;
      if (won) s.last = day;
      s.best = Math.max(s.best, s.streak);
    }
    store.set(`sf:stats:${cat}`, s);
  }

  /* ---------- UI helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  const square = (m) => ({ win: "🟩", miss: "🟥", skip: "⬛" }[m]);

  /* ---------- Game view ---------- */
  function renderGame(cat, day) {
    const puzzle = puzzleFor(cat, day);
    const frames = framesFor(cat, puzzle);
    const st = loadState(cat, day);
    let viewing = Math.min(st.done ? 0 : st.marks.length, MAX_TRIES - 1);
    const key = keyForDay(day);
    const pool = titlePool(cat);

    app.className = `cat-${cat}`;
    app.innerHTML = `
      <div class="puzzle-head">
        <h1>${CATS[cat].emoji} ${CATS[cat].label} #${day}</h1>
        <span class="date">${prettyDate(key)}${day === todayNum ? " · Today" : ""}</span>
        ${day > Math.max(1, todayNum - ARCHIVE_DAYS + 1) || day < todayNum ? `<div class="nav">
          ${day > Math.max(1, todayNum - ARCHIVE_DAYS + 1) ? `<a class="btn small" href="#/${cat}/${day - 1}">‹ Prev</a>` : ""}
          ${day < todayNum ? `<a class="btn small" href="#/${cat}/${day + 1}">Next ›</a>` : ""}
        </div>` : ""}
      </div>
      <div class="stage"><span class="badge" id="badge"></span><div id="frameBox"></div></div>
      <div class="frames" id="frameBtns"></div>
      <div id="controls"></div>
      <ul class="history" id="history"></ul>
      <div id="result"></div>`;

    const frameBox = app.querySelector("#frameBox");
    const badge = app.querySelector("#badge");
    const frameBtns = app.querySelector("#frameBtns");
    const controls = app.querySelector("#controls");
    const history = app.querySelector("#history");
    const result = app.querySelector("#result");

    const unlocked = () => (st.done ? MAX_TRIES : Math.min(st.marks.length + 1, MAX_TRIES));

    function showFrame(i) {
      viewing = i;
      badge.textContent = `Frame ${i + 1} / ${MAX_TRIES}`;
      frameBox.innerHTML = "";
      const img = new Image();
      img.alt = `Frame ${i + 1}`;
      img.onerror = () => {
        frameBox.innerHTML = `<div class="ph"><div><b>${i + 1}</b>Frame image missing<br><code>${esc(frames[i])}</code></div></div>`;
      };
      img.src = frames[i];
      frameBox.appendChild(img);
      // Preload the next unlocked frame for snappy reveals.
      if (frames[i + 1]) new Image().src = frames[i + 1];
      drawFrameBtns();
    }

    function drawFrameBtns() {
      frameBtns.innerHTML = "";
      for (let i = 0; i < MAX_TRIES; i++) {
        const b = document.createElement("button");
        b.textContent = i + 1;
        const mark = st.marks[i];
        if (mark) b.classList.add(mark);
        if (i === viewing) b.classList.add("sel");
        if (i >= unlocked()) { b.classList.add("locked"); b.disabled = true; }
        b.onclick = () => showFrame(i);
        frameBtns.appendChild(b);
      }
    }

    function drawHistory() {
      history.innerHTML = st.guesses.map((g, i) =>
        `<li class="${st.marks[i]}">${st.marks[i] === "skip" ? "Skipped" : esc(g)}</li>`).join("");
    }

    function shareText() {
      const sq = st.marks.map(square).join("") + "⬜".repeat(MAX_TRIES - st.marks.length);
      const score = st.won ? `${st.marks.length}/6` : "X/6";
      return `Sixframe ${CATS[cat].label} #${day} ${score}\n${CATS[cat].emoji} ${sq}\n${location.origin}${location.pathname}`;
    }

    function drawResult() {
      if (!st.done) { result.innerHTML = ""; return; }
      result.innerHTML = `
        <div class="result">
          <h2>${st.won ? "Got it!" : "Out of frames"}</h2>
          <div>The answer was</div>
          <div class="answer">${esc(puzzle.answer)}${puzzle.year ? ` (${puzzle.year})` : ""}</div>
          <div class="squares">${st.marks.map(square).join("")}${"⬜".repeat(MAX_TRIES - st.marks.length)}</div>
          <div class="actions">
            <button class="btn primary" id="shareBtn">Share</button>
            ${nextUnplayedLink(cat, day)}
          </div>
        </div>`;
      result.querySelector("#shareBtn").onclick = async () => {
        const text = shareText();
        try {
          if (navigator.share && matchMedia("(pointer:coarse)").matches) await navigator.share({ text });
          else { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
        } catch { /* user cancelled */ }
      };
    }

    function drawControls() {
      if (st.done) { controls.innerHTML = ""; return; }
      controls.innerHTML = `
        <div class="guess-row">
          <input id="guess" autocomplete="off" placeholder="Type a ${CATS[cat].label.toLowerCase().slice(0, -1)} title…" aria-label="Your guess">
          <button class="btn" id="skipBtn">Skip</button>
          <button class="btn primary" id="goBtn">Guess</button>
          <ul class="suggest" id="suggest" hidden></ul>
        </div>`;
      const input = controls.querySelector("#guess");
      const sug = controls.querySelector("#suggest");
      let hl = -1, items = [];

      function updateSuggest() {
        const q = norm(input.value);
        if (q.length < 2) { sug.hidden = true; items = []; return; }
        const used = new Set(st.guesses.map(norm));
        items = pool.filter((t) => norm(t).includes(q) && !used.has(norm(t))).slice(0, 8);
        hl = -1;
        sug.innerHTML = items.map((t) => `<li>${esc(t)}</li>`).join("");
        sug.hidden = items.length === 0;
        [...sug.children].forEach((li, i) => li.onmousedown = (e) => { e.preventDefault(); input.value = items[i]; sug.hidden = true; submit(); });
      }
      input.addEventListener("input", updateSuggest);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!items.length) return;
          e.preventDefault();
          hl = (hl + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          [...sug.children].forEach((li, i) => li.classList.toggle("hl", i === hl));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (hl >= 0) input.value = items[hl];
          sug.hidden = true; submit();
        } else if (e.key === "Escape") sug.hidden = true;
      });
      input.addEventListener("blur", () => setTimeout(() => sug.hidden = true, 100));
      controls.querySelector("#goBtn").onclick = submit;
      controls.querySelector("#skipBtn").onclick = () => advance("skip", "");
      if (matchMedia("(pointer:fine)").matches) input.focus();

      function submit() {
        const g = input.value.trim();
        if (!g) return;
        if (st.guesses.some((x) => norm(x) === norm(g))) { toast("Already guessed"); return; }
        advance(isCorrect(g, puzzle) ? "win" : "miss", g);
      }
    }

    function advance(mark, guess) {
      st.marks.push(mark);
      st.guesses.push(guess);
      if (mark === "win") { st.done = true; st.won = true; }
      else if (st.marks.length >= MAX_TRIES) st.done = true;
      else if (mark === "miss") toast("Not quite");
      store.set(stateKey(cat, day), st);
      if (st.done) recordResult(cat, day, st.won, st.marks.length);
      paint(st.done ? viewing : st.marks.length);
    }

    function paint(frameIdx) {
      showFrame(frameIdx);
      drawControls();
      drawHistory();
      drawResult();
    }
    paint(viewing);
  }

  function nextUnplayedLink(cat, day) {
    const other = Object.keys(CATS).find((c) => c !== cat && !loadState(c, todayNum).done);
    if (day === todayNum && other) return `<a class="btn" href="#/${other}">Play ${CATS[other].emoji} ${CATS[other].label}</a>`;
    return `<a class="btn" href="#/archive">Archive</a>`;
  }

  /* ---------- Archive view ---------- */
  let archFilter = "all";
  function renderArchive() {
    const first = Math.max(1, todayNum - ARCHIVE_DAYS + 1);
    app.className = "archive";
    let cells = "";
    for (let d = todayNum; d >= first; d--) {
      const links = Object.keys(CATS).filter((c) => archFilter === "all" || archFilter === c).map((c) => {
        const s = loadState(c, d);
        const cls = s.done ? (s.won ? "won" : "lost") : "";
        return `<a class="${cls}" href="#/${c}/${d}" title="${CATS[c].label}">${CATS[c].emoji}</a>`;
      }).join("");
      cells += `<div class="arch-day"><div class="n">#${d}${d === todayNum ? " · Today" : ""}</div><div class="d">${prettyDate(keyForDay(d))}</div><div class="links">${links}</div></div>`;
    }
    app.innerHTML = `
      <h1>Archive</h1>
      <p>The last ${Math.min(ARCHIVE_DAYS, todayNum)} days. Green = solved, red = missed.</p>
      <div class="arch-filter">
        ${["all", ...Object.keys(CATS)].map((f) => `<button class="btn small ${archFilter === f ? "active" : ""}" data-f="${f}">${f === "all" ? "All" : CATS[f].emoji + " " + CATS[f].label}</button>`).join("")}
      </div>
      <div class="arch-grid">${cells}</div>`;
    app.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { archFilter = b.dataset.f; renderArchive(); });
  }

  /* ---------- Stats dialog ---------- */
  function renderStats() {
    document.getElementById("statsBody").innerHTML = Object.entries(CATS).map(([c, meta]) => {
      const s = store.get(`sf:stats:${c}`, { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] });
      const max = Math.max(1, ...s.dist);
      return `<div class="stat-cat cat-${c}">
        <h3>${meta.emoji} ${meta.label}</h3>
        <div class="stat-nums">
          <div><b>${s.played}</b><span>Played</span></div>
          <div><b>${s.played ? Math.round((s.wins / s.played) * 100) : 0}%</b><span>Win</span></div>
          <div><b>${s.streak}</b><span>Streak</span></div>
          <div><b>${s.best}</b><span>Best</span></div>
        </div>
        <div class="dist">${s.dist.map((n, i) => `<div>${i + 1}<i style="width:${(n / max) * 100}%"></i>${n}</div>`).join("")}</div>
      </div>`;
    }).join("");
    document.getElementById("statsDlg").showModal();
  }

  /* ---------- Router ---------- */
  function parseHash() {
    const [, view = "", day = ""] = location.hash.split("/");
    if (view === "archive") return { view, day: null };
    const cat = CATS[view] ? view : "movies";
    let d = parseInt(day, 10);
    const first = Math.max(1, todayNum - ARCHIVE_DAYS + 1);
    if (!d || d > todayNum || d < first) d = null;
    return { view: cat, day: d };
  }
  function render() {
    route = parseHash();
    document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.cat === route.view));
    if (route.view === "archive") renderArchive();
    else renderGame(route.view, route.day || todayNum);
    window.scrollTo(0, 0);
  }

  /* ---------- Live clock + midnight rollover ---------- */
  function tick() {
    const ms = msToNextMidnight();
    const s = Math.floor(ms / 1000);
    document.getElementById("countdown").textContent =
      [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
    const n = dayNumFor(etKey());
    if (n !== todayNum) {
      const wasToday = route.view !== "archive" && !route.day;
      todayNum = n;
      if (wasToday || route.view === "archive") render();
      toast("New puzzles are live!");
    }
  }

  /* ---------- Boot ---------- */
  async function boot() {
    try {
      const res = await fetch("data/puzzles.json", { cache: "no-cache" });
      DATA = await res.json();
    } catch (e) {
      app.innerHTML = `<p>Couldn't load puzzles. If you opened index.html directly, serve the folder over HTTP (e.g. GitHub Pages or <code>python -m http.server</code>).</p>`;
      return;
    }
    todayNum = dayNumFor(etKey());
    if (todayNum < 1) {
      app.innerHTML = `<p>Sixframe launches on ${prettyDate(DATA.start)}. See you then!</p>`;
      return;
    }
    document.getElementById("statsBtn").onclick = renderStats;
    window.addEventListener("hashchange", render);
    // Re-check the date when the tab wakes up (sleeping laptops, phones).
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    render();
    tick();
    setInterval(tick, 1000);
  }
  boot();
})();
