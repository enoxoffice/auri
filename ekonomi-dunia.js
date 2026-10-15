/*!
 * Ekonomi Dunia — panel berita makro & dampak ke emas (XAUUSD)
 * Self-contained: inject CSS sendiri, tanpa dependensi.
 *
 * Pakai (muat file ini dengan tag script bersumber ekonomi-dunia.js, atau paste isinya inline):
 *   siapkan satu elemen kosong, misalnya div dengan id "ed-root", lalu panggil:
 *   EkonomiDunia.mount(document.getElementById('ed-root'), { endpoint: '/.netlify/functions/econ' });
 *
 * Warna ikut CSS variable host (--accent, --surface, --line, --text, --muted, --loss) dengan fallback.
 * Data berita dari Netlify Function econ.mjs (API key aman di server).
 * Kalender rilis: statis & terverifikasi (BLS / Census / The Fed), edit SCHEDULE di bawah kalau ada perubahan jadwal.
 */
(function (global) {
  'use strict';

  /* Jadwal rilis (waktu ET, offset sudah termasuk DST). Diverifikasi 15 Okt 2026. */
  var SCHEDULE = [
    { t: 'cpi',    at: '2026-10-14T08:30:00-04:00', name: 'CPI AS (Sep)',                 high: true },
    { t: 'ppi',    at: '2026-10-15T08:30:00-04:00', name: 'PPI AS (Sep)',                 high: false },
    { t: 'retail', at: '2026-10-15T08:30:00-04:00', name: 'Penjualan Ritel AS (Sep)',     high: false },
    { t: 'fomc',   at: '2026-10-28T14:00:00-04:00', name: 'Keputusan FOMC (27–28 Okt)',   high: true },
    { t: 'nfp',    at: '2026-11-06T08:30:00-05:00', name: 'Nonfarm Payrolls (Okt)',       high: true },
    { t: 'cpi',    at: '2026-11-10T08:30:00-05:00', name: 'CPI AS (Okt)',                 high: true },
    { t: 'ppi',    at: '2026-11-13T08:30:00-05:00', name: 'PPI AS (Okt)',                 high: false },
    { t: 'retail', at: '2026-11-17T08:30:00-05:00', name: 'Penjualan Ritel AS (Okt)',     high: false },
    { t: 'nfp',    at: '2026-12-04T08:30:00-05:00', name: 'Nonfarm Payrolls (Nov)',       high: true },
    { t: 'fomc',   at: '2026-12-09T14:00:00-05:00', name: 'Keputusan FOMC (8–9 Des)',     high: true },
    { t: 'cpi',    at: '2026-12-10T08:30:00-05:00', name: 'CPI AS (Nov)',                 high: true },
    { t: 'ppi',    at: '2026-12-15T08:30:00-05:00', name: 'PPI AS (Nov)',                 high: false },
    { t: 'retail', at: '2026-12-16T08:30:00-05:00', name: 'Penjualan Ritel AS (Nov)',     high: false }
  ].map(function (e) { e.ms = Date.parse(e.at); return e; });

  var BADGE = {
    up:      { icon: '🟢', text: 'Emas Naik',  cls: 'up' },
    down:    { icon: '🔴', text: 'Emas Turun', cls: 'dn' },
    neutral: { icon: '🟡', text: 'Netral',     cls: 'nt' }
  };
  var CACHE_MS = 5 * 60e3;
  var shared = { data: null, at: 0 };

  var CSS = '\
.ed{display:grid;gap:14px;color:var(--text,#0d1a11);min-width:0}\
.ed *{box-sizing:border-box}\
.ed-col{display:contents}\
.ed-card{background:var(--surface,#fff);border:1px solid var(--line,#e1e6dd);border-radius:20px;padding:16px;min-width:0}\
.ed-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}\
.ed-top p{margin:0;font-size:12.5px;color:var(--muted,#5f6d63)}\
.ed-btn{font:600 14px/1 inherit;font-family:inherit;border:1px solid var(--line,#e1e6dd);background:var(--surface2,#f0f2ed);color:var(--text,#0d1a11);border-radius:12px;min-height:40px;padding:0 14px;cursor:pointer;transition:transform .12s,background .2s}\
.ed-btn:active{transform:scale(.97)}.ed-btn[disabled]{opacity:.55;cursor:default}\
.ed-btn.pri{background:var(--accent,#0b5a2b);color:var(--accent-ink,#fff);border-color:transparent}\
.ed h3{margin:0 0 10px;font:600 16px/1.2 var(--disp,inherit)}\
.ed-mk{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}\
.ed-mc{background:var(--surface2,#f0f2ed);border-radius:14px;padding:10px;min-width:0}\
.ed-mc span{display:block;font-size:12px;color:var(--muted,#5f6d63)}\
.ed-mc b{display:block;font:500 15px/1.3 var(--mono,ui-monospace,monospace);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.ed-mc small{display:block;font:500 11.5px/1.3 var(--mono,ui-monospace,monospace);margin-top:1px}\
.ed-mc i{display:block;font-style:normal;font-size:11px;margin-top:5px;white-space:nowrap}\
.ed .up{color:var(--accent,#0b5a2b)}.ed .dn{color:var(--loss,#b3261e)}.ed .nt{color:var(--muted,#5f6d63)}\
.ed-next{border-radius:14px;padding:12px 14px;background:var(--accent-soft,rgba(11,90,43,.1));margin-bottom:10px}\
.ed-next span{font-size:12px;color:var(--muted,#5f6d63)}\
.ed-next b{display:block;font:600 15px/1.3 inherit;margin:2px 0 4px}\
.ed-cd{font:500 22px/1.1 var(--mono,ui-monospace,monospace);letter-spacing:-.02em;color:var(--accent,#0b5a2b);font-variant-numeric:tabular-nums}\
.ed-ev{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line,#e1e6dd)}\
.ed-ev:first-of-type{border-top:0}\
.ed-dot{width:8px;height:8px;border-radius:50%;background:var(--muted,#5f6d63);opacity:.5}\
.ed-dot.hi{background:var(--loss,#b3261e);opacity:1}\
.ed-ev b{display:block;font-weight:600;font-size:14px;overflow-wrap:anywhere}\
.ed-ev small{display:block;font-size:12px;color:var(--muted,#5f6d63)}\
.ed-ev em{font:500 12px/1.2 var(--mono,ui-monospace,monospace);font-style:normal;color:var(--muted,#5f6d63);text-align:right}\
.ed-ev.past{opacity:.55}\
.ed-lab{font-size:12px;color:var(--muted,#5f6d63);margin:10px 0 2px}\
.ed-al{display:grid;gap:8px}\
.ed-ac{border:1px solid var(--line,#e1e6dd);border-left:3px solid var(--loss,#b3261e);border-radius:14px;padding:11px 13px;background:var(--surface,#fff);min-width:0}\
.ed-ac.up{border-left-color:var(--accent,#0b5a2b)}\
.ed-ac b{display:block;font-size:14px;line-height:1.35;overflow-wrap:anywhere}\
.ed-ac small{display:block;margin-top:3px;font-size:12px;color:var(--muted,#5f6d63)}\
.ed-chips{display:flex;gap:6px;overflow-x:auto;margin:0 -2px 12px;padding:2px;scrollbar-width:none}\
.ed-chips::-webkit-scrollbar{display:none}\
.ed-chip{flex:none;font:500 13px/1 inherit;font-family:inherit;border:1px solid var(--line,#e1e6dd);background:transparent;color:var(--text,#0d1a11);border-radius:999px;min-height:36px;padding:0 13px;cursor:pointer;transition:background .2s,color .2s}\
.ed-chip.on{background:var(--accent,#0b5a2b);color:var(--accent-ink,#fff);border-color:transparent}\
.ed-news{display:grid;gap:10px}\
.ed-it{border:1px solid var(--line,#e1e6dd);border-radius:16px;padding:14px;min-width:0;animation:edIn .35s ease both}\
.ed-it h4{margin:0;font:600 15px/1.35 inherit;overflow-wrap:anywhere}\
.ed-it h4 a{color:inherit;text-decoration:none}.ed-it h4 a:hover{text-decoration:underline}\
.ed-it p{margin:6px 0 10px;font-size:14px;line-height:1.5;color:var(--text,#0d1a11)}\
.ed-bd{display:inline-flex;gap:6px;align-items:flex-start;font-size:13px;line-height:1.35;border-radius:12px;padding:7px 10px;background:var(--surface2,#f0f2ed);max-width:100%}\
.ed-bd.up{background:var(--accent-soft,rgba(11,90,43,.1))}.ed-bd.dn{background:var(--loss-soft,rgba(179,38,30,.09))}\
.ed-bd b{white-space:nowrap}.ed-bd span{color:var(--text,#0d1a11)}\
.ed-meta{margin-top:9px;font-size:12px;color:var(--muted,#5f6d63);display:flex;flex-wrap:wrap;gap:4px 10px}\
.ed-msg{text-align:center;padding:26px 12px;color:var(--muted,#5f6d63);font-size:14px;line-height:1.5}\
.ed-msg .ed-btn{margin-top:12px}\
.ed-sk{height:112px;border-radius:16px;background:linear-gradient(90deg,var(--surface2,#f0f2ed),var(--line,#e1e6dd),var(--surface2,#f0f2ed));background-size:200% 100%;animation:edSk 1.2s linear infinite}\
.ed-toasts{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:90;display:grid;gap:8px;width:min(420px,calc(100vw - 24px));pointer-events:none}\
.ed-toast{pointer-events:auto;background:var(--surface,#fff);color:var(--text,#0d1a11);border:1px solid var(--line,#e1e6dd);border-left:3px solid var(--accent,#0b5a2b);border-radius:14px;padding:11px 13px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:13px;line-height:1.4;animation:edToast .4s cubic-bezier(.2,.7,.2,1) both;cursor:pointer}\
.ed-toast.dn{border-left-color:var(--loss,#b3261e)}.ed-toast.nt{border-left-color:var(--muted,#5f6d63)}\
.ed-toast b{display:block;margin-bottom:2px}\
.ed-toast.out{opacity:0;transform:translateY(-8px);transition:.3s}\
@keyframes edIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\
@keyframes edSk{to{background-position:-200% 0}}\
@keyframes edToast{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}\
@media(min-width:960px){.ed{grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);align-items:start}.ed-top{grid-column:1/-1}.ed-col{display:grid;gap:14px;min-width:0}}\
@media(prefers-reduced-motion:reduce){.ed-it,.ed-toast,.ed-sk{animation:none}}';

  /* ───────── util ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }
  function p2(n) { return String(n).padStart(2, '0'); }
  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' mnt lalu';
    if (m < 1440) return Math.floor(m / 60) + ' jam lalu';
    return Math.floor(m / 1440) + ' hari lalu';
  }
  var WIB = { timeZone: 'Asia/Jakarta' };
  function wib(ms) {
    var d = new Intl.DateTimeFormat('id-ID', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }, WIB)).format(new Date(ms));
    return d.replace(/\./g, ':').replace(',', ' ·') + ' WIB';
  }
  function countdown(ms) {
    var s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (d ? d + ' hari ' : '') + p2(h) + ':' + p2(m) + ':' + p2(x);
  }
  function weekRange() { // Senin 00:00 WIB s/d Senin berikutnya
    var j = new Date(Date.now() + 7 * 3600e3);
    var dow = (j.getUTCDay() + 6) % 7;
    var start = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - dow) - 7 * 3600e3;
    return [start, start + 7 * 86400e3];
  }
  function fx(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function injectCss() {
    if (document.getElementById('ed-style')) return;
    var s = document.createElement('style'); s.id = 'ed-style'; s.textContent = CSS; document.head.appendChild(s);
  }

  /* ───────── mount ───────── */
  function mount(root, opts) {
    opts = opts || {};
    var endpoint = opts.endpoint || '/.netlify/functions/econ';
    injectCss();

    var st = { data: shared.data, loading: false, error: null, filter: 'all' };
    var timers = [], dead = false;
    var toasts = document.querySelector('.ed-toasts');
    if (!toasts) { toasts = document.createElement('div'); toasts.className = 'ed-toasts'; document.body.appendChild(toasts); }

    root.innerHTML = '<div class="ed"></div>';
    var el = root.firstChild;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ed]'); if (!b) return;
      if (b.dataset.ed === 'reload') load(true);
      if (b.dataset.ed === 'filter') { st.filter = b.dataset.v; draw(); }
    });

    function errText(code) {
      if (code === 'no_key') return 'Sumber berita belum dikonfigurasi. Isi API key di Environment Variables Netlify.';
      return 'Sumber berita sedang penuh, coba lagi nanti.';
    }

    function load(force) {
      if (st.loading || dead) return;
      if (!force && shared.data && Date.now() - shared.at < CACHE_MS) { st.data = shared.data; draw(); return; }
      st.loading = true; st.error = null; draw();
      var ctl = new AbortController();
      var to = setTimeout(function () { ctl.abort(); }, 20000);
      fetch(endpoint + (force ? '?force=1' : ''), { signal: ctl.signal, headers: { accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
        .then(function (j) {
          if (j.error && !(j.items && j.items.length)) { st.error = errText(j.error); st.data = j; return; }
          st.data = j; st.error = null; shared.data = j; shared.at = Date.now();
        })
        .catch(function () { st.error = errText('rate_limit'); })
        .then(function () { clearTimeout(to); st.loading = false; if (!dead) { draw(); toastTop(); } });
    }

    /* ── bagian UI ── */
    function badge(it) {
      var b = BADGE[it.impact] || BADGE.neutral;
      return '<div class="ed-bd ' + b.cls + '"><b>' + b.icon + ' ' + b.text + '</b><span>' + esc(it.reason) + '</span></div>';
    }
    function marketHtml() {
      var m = (st.data && st.data.market) || {};
      function cell(label, x, kind) {
        if (!x) return '<div class="ed-mc"><span>' + label + '</span><b>–</b><small class="nt">tidak tersedia</small></div>';
        var up = x.pct > 0;
        var delta, lab = '';
        if (kind === 'yield') { var bps = x.change * 100; delta = (bps > 0 ? '+' : '') + fx(bps, 1) + ' bps'; }
        else delta = (up ? '+' : '') + fx(x.pct, 2) + '%';
        var cls = x.pct > 0 ? 'up' : x.pct < 0 ? 'dn' : 'nt';
        if (kind === 'dxy' || kind === 'yield') {
          var small = kind === 'yield' ? Math.abs(x.change * 100) < 2 : Math.abs(x.pct) < 0.1;
          var imp = small ? 'neutral' : (x.pct > 0 ? 'down' : 'up'); // dolar/yield naik → emas turun
          var bd = BADGE[imp]; lab = '<i class="' + bd.cls + '">' + bd.icon + ' ' + bd.text + '</i>';
        }
        return '<div class="ed-mc"><span>' + label + '</span><b>' + fx(x.price, kind === 'gold' ? 2 : kind === 'yield' ? 3 : 2) + (kind === 'yield' ? '%' : '') + '</b><small class="' + cls + '">' + delta + '</small>' + lab + '</div>';
      }
      return '<section class="ed-card" style="order:2"><h3>Pasar sekarang</h3><div class="ed-mk">' +
        cell('Emas', m.gold, 'gold') + cell('DXY', m.dxy, 'dxy') + cell('US 10Y', m.us10y, 'yield') + '</div></section>';
    }
    function eventsHtml() {
      var now = Date.now(), wk = weekRange();
      var upcoming = SCHEDULE.filter(function (e) { return e.ms > now; });
      var next = upcoming[0];
      var thisWeek = SCHEDULE.filter(function (e) { return e.ms >= wk[0] && e.ms < wk[1]; });
      var later = upcoming.filter(function (e) { return e.ms >= wk[1]; }).slice(0, 3);
      function row(e) {
        var past = e.ms <= now;
        return '<div class="ed-ev' + (past ? ' past' : '') + '"><span class="ed-dot' + (e.high ? ' hi' : '') + '"></span><div><b>' + esc(e.name) + '</b><small>' + wib(e.ms) + (e.high ? ' · berdampak besar' : '') + '</small></div><em>' + (past ? 'sudah rilis' : '<span data-cd="' + e.ms + '">' + countdown(e.ms) + '</span>') + '</em></div>';
      }
      var h = '<section class="ed-card" style="order:3"><h3>Event mendatang minggu ini</h3>';
      if (next) h += '<div class="ed-next"><span>Rilis berikutnya</span><b>' + esc(next.name) + '</b><div class="ed-cd" data-cd="' + next.ms + '">' + countdown(next.ms) + '</div></div>';
      h += thisWeek.length ? thisWeek.map(row).join('') : '<div class="ed-msg" style="padding:10px 0">Tidak ada rilis besar minggu ini.</div>';
      if (later.length) h += '<div class="ed-lab">Setelahnya</div>' + later.map(row).join('');
      return h + '</section>';
    }
    function alertsHtml() {
      var now = Date.now(), cards = [];
      SCHEDULE.forEach(function (e) {
        if (e.high && e.ms > now && e.ms - now < 48 * 3600e3)
          cards.push('<div class="ed-ac"><b>' + esc(e.name) + ' segera rilis</b><small>' + wib(e.ms) + ' · <span data-cd="' + e.ms + '">' + countdown(e.ms) + '</span> lagi. Potensi pergerakan besar di emas.</small></div>');
      });
      hot().slice(0, 3).forEach(function (it) {
        var b = BADGE[it.impact];
        cards.push('<div class="ed-ac ' + b.cls + '"><b>' + b.icon + ' ' + esc(it.title) + '</b><small>' + b.text + ': ' + esc(it.reason) + '</small></div>');
      });
      return cards.length ? '<section class="ed-card" style="order:1"><h3>Perlu diperhatikan</h3><div class="ed-al">' + cards.join('') + '</div></section>' : '';
    }
    function hot() {
      var items = (st.data && st.data.items) || [];
      return items.filter(function (i) { return i.high && Date.now() - Date.parse(i.time) < 24 * 3600e3; })
        .sort(function (a, b) { return b.score - a.score; });
    }
    function newsHtml() {
      var items = (st.data && st.data.items) || [];
      var f = st.filter;
      var shown = items.filter(function (i) { return f === 'all' || (f === 'sched' ? i.scheduled : i.impact === f); });
      function n(fn) { return items.filter(fn).length; }
      var chips = [['all', 'Semua', items.length], ['up', 'Emas Naik', n(function (i) { return i.impact === 'up'; })], ['down', 'Emas Turun', n(function (i) { return i.impact === 'down'; })], ['sched', 'Event Terjadwal', n(function (i) { return i.scheduled; })]]
        .map(function (c) { return '<button class="ed-chip' + (f === c[0] ? ' on' : '') + '" data-ed="filter" data-v="' + c[0] + '">' + c[1] + ' (' + c[2] + ')</button>'; }).join('');
      var body;
      if (st.loading && !items.length) body = '<div class="ed-news"><div class="ed-sk"></div><div class="ed-sk"></div><div class="ed-sk"></div></div>';
      else if (st.error && !items.length) body = '<div class="ed-msg">' + esc(st.error) + '<br><button class="ed-btn pri" data-ed="reload">Muat Ulang</button></div>';
      else if (!items.length) body = '<div class="ed-msg">Belum ada berita ekonomi yang relevan dalam 3 hari terakhir.<br><button class="ed-btn pri" data-ed="reload">Muat Ulang</button></div>';
      else if (!shown.length) body = '<div class="ed-msg">Tidak ada berita untuk filter ini.</div>';
      else body = '<div class="ed-news">' + shown.map(function (it) {
        return '<article class="ed-it"><h4><a href="' + esc(safeUrl(it.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '</a></h4><p>' + esc(it.summary) + '</p>' + badge(it) +
          '<div class="ed-meta"><span>' + esc(it.topicLabel) + '</span><span>' + esc(it.source || '') + '</span><time datetime="' + esc(it.time) + '">' + ago(it.time) + '</time></div></article>';
      }).join('') + '</div>';
      return '<section class="ed-card" style="order:4"><h3>Berita ekonomi dunia</h3>' + (items.length ? '<div class="ed-chips">' + chips + '</div>' : '') + (st.error && items.length ? '<div class="ed-msg" style="padding:0 0 12px">' + esc(st.error) + '</div>' : '') + body + '</section>';
    }

    function draw() {
      if (dead) return;
      var fetched = st.data && st.data.fetchedAt ? 'Diperbarui ' + ago(st.data.fetchedAt) : 'Memuat data…';
      el.innerHTML =
        '<div class="ed-top"><p>' + fetched + '. Sumber: berita gratis, jadwal resmi BLS, Census dan The Fed.</p><button class="ed-btn" data-ed="reload"' + (st.loading ? ' disabled' : '') + '>' + (st.loading ? 'Memuat…' : 'Muat Ulang') + '</button></div>' +
        '<div class="ed-col">' + alertsHtml() + newsHtml() + '</div>' +
        '<div class="ed-col">' + (st.data ? marketHtml() : '') + eventsHtml() + '</div>';
    }

    function toastTop() {
      var seen; try { seen = JSON.parse(localStorage.getItem('ed-seen') || '[]'); } catch (e) { seen = []; }
      var fresh = hot().filter(function (i) { return seen.indexOf(i.id) < 0; }).slice(0, 3);
      fresh.forEach(function (it, k) {
        setTimeout(function () {
          var b = BADGE[it.impact];
          var t = document.createElement('div');
          t.className = 'ed-toast ' + b.cls;
          t.innerHTML = '<b>' + b.icon + ' ' + b.text + '</b>' + esc(it.title);
          var kill = function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); };
          t.addEventListener('click', kill);
          toasts.appendChild(t);
          setTimeout(kill, 7000);
        }, k * 450);
      });
      if (fresh.length) {
        seen = seen.concat(fresh.map(function (i) { return i.id; })).slice(-200);
        try { localStorage.setItem('ed-seen', JSON.stringify(seen)); } catch (e) { /* storage penuh/diblokir */ }
      }
    }

    /* tick countdown + auto refresh */
    timers.push(setInterval(function () {
      if (!root.isConnected) return destroy();
      el.querySelectorAll('[data-cd]').forEach(function (n) { n.textContent = countdown(+n.dataset.cd); });
    }, 1000));
    timers.push(setInterval(function () { if (document.visibilityState === 'visible') load(false); }, 10 * 60e3));

    function destroy() { dead = true; timers.forEach(clearInterval); }

    draw();
    load(false);
    return { reload: function () { load(true); }, destroy: destroy };
  }

  global.EkonomiDunia = { mount: mount, schedule: SCHEDULE };
})(window);
