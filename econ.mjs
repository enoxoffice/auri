// netlify/functions/econ.mjs
// Backend "Ekonomi Dunia": ambil berita 72 jam terakhir dari sumber gratis,
// lalu klasifikasi topik + arah emas + ringkasan Indonesia (rule-based, tanpa LLM).
// API key dibaca dari Environment Variables Netlify (JANGAN ditulis di sini):
//   ALPHAVANTAGE_KEY, FMP_KEY, NEWSAPI_KEY, TWELVEDATA_KEY (semua opsional, minimal 1 sumber berita)

const WINDOW_MS = 72 * 3600e3;
const TTL_MS = 10 * 60e3; // cache memori, jaga kuota free tier
let cache = null;

/* ───────────── Aturan makro → emas ───────────── */
const TOPICS = [
  { id: 'fomc', label: 'FOMC / The Fed', w: 5, scheduled: true,
    re: /\b(fomc|federal open market|fed (?:holds|keeps|cuts|raises|hikes|signals|minutes|decision|rate)|rate (?:cut|cuts|hike|hikes|decision)|interest rate decision|dot plot|monetary policy)\b/i },
  { id: 'fedchair', label: 'Ketua Fed', w: 4, scheduled: false,
    re: /\b(fed chair|fed chief|powell|warsh|hassett|fed governor|fed officials?|fed's [a-z]+ (?:says|said|warns))\b/i },
  { id: 'cpi', label: 'Inflasi (CPI)', w: 5, scheduled: true,
    re: /\b(cpi|consumer price|core inflation|inflation|pce)\b/i },
  { id: 'ppi', label: 'Harga produsen (PPI)', w: 3, scheduled: true,
    re: /\b(ppi|producer price|wholesale (?:prices|inflation))\b/i },
  { id: 'nfp', label: 'Tenaga kerja (NFP)', w: 5, scheduled: true,
    re: /\b(nonfarm|non-farm|nfp|payrolls?|jobs report|employment situation|unemployment rate|jobless claims|job openings|jolts|adp)\b/i },
  { id: 'retail', label: 'Penjualan ritel', w: 3, scheduled: true,
    re: /\bretail sales\b/i },
  { id: 'usd', label: 'Dolar & yield', w: 3, scheduled: false,
    re: /\b(dollar|dxy|greenback|(?<!dividend |earnings |rental )yields?)\b/i },
  { id: 'geo', label: 'Geopolitik', w: 3, scheduled: false,
    re: /\b(war|invasion|missile|airstrikes?|sanctions?|tensions?|conflict|ceasefire|truce|escalat\w+|nuclear|hostilities|safe[- ]haven|geopolitic\w*|trade war|tariffs?)\b/i },
  { id: 'gold', label: 'Emas', w: 2, scheduled: false,
    re: /\b(gold|bullion|xau)\b/i },
];

const HOT = /(hotter|higher[- ]than[- ](?:expected|forecast)|above (?:expectations|forecasts?|estimates)|re-?accelerat\w+|accelerat\w+|sticky|stubborn|surg\w+|jump\w*|climb\w*|rises?|rose|upside surprise|beats?)/gi;
const COOL = /(cooler|softer|lower[- ]than[- ](?:expected|forecast)|below (?:expectations|forecasts?|estimates)|slows?|slowed|eases?|eased|moderat\w+|decelerat\w+|falls?|fell|drops?|dropped|declin\w+|misses?|undershoot\w*)/gi;
const HAWK = /(hawkish|rate hikes?|raise rates?|raising rates?|hike rates?|higher for longer|no (?:rate )?cuts?|rule out cuts?|delay\w* (?:rate )?cuts?|tighten\w*|fewer cuts|resist\w* cuts)/gi;
const DOVE = /(dovish|rate cuts?|cut rates?|cutting rates?|easing|eases|pause\w*|signals? cuts?|open to cuts?|lower rates?|more cuts|accommodat\w+)/gi;
const STRONG = /(strong\w*|beats?|better than expected|adds? more|stronger[- ]than|hiring surges?|unemployment (?:falls|drops|dips|declines)|jobless claims (?:fall|drop|decline)|resilient|robust|solid|tops? (?:estimates|forecasts?)|rebound\w*)/gi;
const WEAK = /(weak\w*|misses?|below expectations|worse than expected|fewer jobs|lost jobs|job losses|unemployment (?:rises|climbs|jumps)|jobless claims (?:rise|jump|climb)|layoffs|slump\w*|cools?|cooling|slows?|contract\w*|disappoint\w*|stall\w*)/gi;
const USD_UP = /(dollar (?:rises?|gains?|strengthens?|climbs?|jumps?|rallies|firms|surges?|advances)|stronger dollar|greenback (?:gains|rises|firms)|yields? (?:rise|rises|climb|climbs|jump|jumps|surge|surges|higher)|yields? at (?:highest|high)|bond sell-?off|treasury sell-?off)/gi;
const USD_DN = /(dollar (?:falls?|slips?|weakens?|drops?|declines?|slides?|retreats?|sinks?|eases)|weaker dollar|greenback (?:falls|slips|weakens)|yields? (?:fall|falls|drop|drops|slip|slips|decline|declines|lower|retreat|tumble)|bond rally|treasuries rally)/gi;
const RISK = /(war|invasion|missile|airstrikes?|strikes?|sanctions?|escalat\w+|tensions?|attacks?|conflict|nuclear|hostilities|safe[- ]haven|crisis|turmoil|panic|trade war|tariffs?)/gi;
const CALM = /(ceasefire|truce|peace (?:deal|talks?|agreement)|de-escalat\w+|agreement reached|tensions? ease\w*)/gi;
const GOLD_UP = /((?:gold|bullion) (?:rises?|rallies|jumps|climbs|gains|surges|hits|extends gains|advances|steadies higher))/gi;
const GOLD_DN = /((?:gold|bullion) (?:falls?|slips|drops|slides|declines|sinks|retreats|tumbles|extends losses))/gi;

// a → dirA, b → dirB (arah EMAS). bBoost: bobot pembanding.
const RULES = {
  cpi:      { a: HOT,    da: 'down', b: COOL,   db: 'up' },   // inflasi tinggi → emas turun
  ppi:      { a: HOT,    da: 'down', b: COOL,   db: 'up' },
  fomc:     { a: HAWK,   da: 'down', b: DOVE,   db: 'up' },   // hawkish → turun, dovish → naik
  fedchair: { a: HAWK,   da: 'down', b: DOVE,   db: 'up' },
  nfp:      { a: STRONG, da: 'down', b: WEAK,   db: 'up' },   // NFP kuat → turun
  retail:   { a: STRONG, da: 'down', b: WEAK,   db: 'up' },
  usd:      { a: USD_UP, da: 'down', b: USD_DN, db: 'up' },   // dolar/yield naik → emas turun
  geo:      { a: RISK,   da: 'up',   b: CALM,   db: 'down', bBoost: 2 }, // geopolitik → emas naik
  gold:     { a: GOLD_UP, da: 'up',  b: GOLD_DN, db: 'down' },
};

const REASON = {
  cpi:      { up: 'Inflasi lebih rendah, Fed longgar, dolar dan yield turun', down: 'Inflasi lebih tinggi, Fed ketat, dolar dan yield naik' },
  ppi:      { up: 'Harga produsen lebih rendah, tekanan inflasi mereda', down: 'Harga produsen lebih tinggi, inflasi sulit turun' },
  fomc:     { up: 'Nada dovish, peluang bunga turun, dolar melemah', down: 'Nada hawkish, bunga tinggi lebih lama, dolar menguat' },
  fedchair: { up: 'Nada dovish, peluang bunga turun, dolar melemah', down: 'Nada hawkish, bunga tinggi lebih lama, dolar menguat' },
  nfp:      { up: 'Data kerja lemah, Fed condong longgar, yield turun', down: 'Data kerja kuat, Fed tetap ketat, yield naik' },
  retail:   { up: 'Konsumsi melemah, Fed condong longgar, yield turun', down: 'Konsumsi kuat, Fed tetap ketat, dolar naik' },
  usd:      { up: 'Dolar atau yield turun, emas lebih menarik', down: 'Dolar atau yield naik, emas jadi lebih mahal' },
  geo:      { up: 'Risiko geopolitik naik, investor cari aset aman', down: 'Ketegangan mereda, permintaan aset aman berkurang' },
  gold:     { up: 'Harga emas sedang menguat, momentum beli', down: 'Harga emas sedang melemah, tekanan jual' },
};
const NEUTRAL_REASON = 'Belum ada sinyal arah yang jelas untuk emas';

const LEAD = {
  cpi:      { down: 'Berita ini menunjukkan inflasi AS lebih panas dari perkiraan', up: 'Berita ini menunjukkan inflasi AS lebih dingin dari perkiraan', neutral: 'Berita ini membahas perkembangan inflasi AS' },
  ppi:      { down: 'Harga produsen AS terlihat lebih tinggi dari perkiraan', up: 'Harga produsen AS terlihat lebih rendah dari perkiraan', neutral: 'Berita ini membahas harga produsen (PPI) AS' },
  fomc:     { down: 'The Fed mengisyaratkan sikap hawkish, bunga bisa tinggi lebih lama', up: 'The Fed mengisyaratkan sikap dovish, peluang pemangkasan bunga terbuka', neutral: 'Berita ini membahas rapat dan kebijakan suku bunga The Fed' },
  fedchair: { down: 'Pejabat atau Ketua Fed terdengar hawkish soal suku bunga', up: 'Pejabat atau Ketua Fed terdengar dovish soal suku bunga', neutral: 'Berita ini memuat pernyataan pejabat atau Ketua Fed' },
  nfp:      { down: 'Data tenaga kerja AS terlihat kuat', up: 'Data tenaga kerja AS terlihat melemah', neutral: 'Berita ini membahas data tenaga kerja AS' },
  retail:   { down: 'Penjualan ritel AS terlihat kuat', up: 'Penjualan ritel AS terlihat lemah', neutral: 'Berita ini membahas penjualan ritel AS' },
  usd:      { down: 'Dolar AS atau yield Treasury sedang naik', up: 'Dolar AS atau yield Treasury sedang turun', neutral: 'Berita ini membahas dolar AS dan yield Treasury' },
  geo:      { up: 'Ketegangan geopolitik atau ketakutan pasar meningkat', down: 'Ketegangan geopolitik mulai mereda', neutral: 'Berita ini membahas perkembangan geopolitik yang dipantau pasar' },
  gold:     { up: 'Harga emas sedang menguat', down: 'Harga emas sedang melemah', neutral: 'Berita ini membahas pergerakan harga emas' },
};

const count = (re, s) => (s.match(re) || []).length;
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function dirOf(topicId, text) {
  const r = RULES[topicId];
  const ca = count(r.a, text);
  const cb = count(r.b, text) * (r.bBoost || 1);
  if (ca > cb) return r.da;
  if (cb > ca) return r.db;
  return 'neutral';
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'n' + (h >>> 0).toString(36);
}

/** Klasifikasi satu berita. null = tidak relevan. */
export function classify(item, now = Date.now()) {
  const text = `${item.title}. ${item.summary || ''}`;
  const matched = TOPICS.filter((t) => t.re.test(text));
  if (!matched.length) return null;

  const scored = matched.map((t) => ({
    t,
    dir: dirOf(t.id, text),
    inTitle: t.re.test(item.title) ? 1 : 0,
  }));
  scored.sort((x, y) =>
    (y.dir !== 'neutral') - (x.dir !== 'neutral') || y.t.w - x.t.w || y.inTitle - x.inTitle);
  const best = scored[0];
  const { t, dir } = best;

  const pct = (text.match(/\b\d{1,2}(?:[.,]\d{1,2})?\s?%/) || [])[0];
  const lead = LEAD[t.id][dir] + (pct ? ` (angka yang disebut: ${pct.replace('.', ',').replace(/\s/g, '')})` : '') + '.';
  const reason = dir === 'neutral' ? NEUTRAL_REASON : REASON[t.id][dir];
  const tail = dir === 'up' ? `Untuk emas cenderung positif: ${lcFirst(reason)}.`
    : dir === 'down' ? `Untuk emas cenderung tertekan: ${lcFirst(reason)}.`
    : 'Untuk emas belum ada arah jelas, tunggu konfirmasi pasar.';

  const age = now - item.time;
  const recency = age < 6 * 3600e3 ? 1.5 : age < 24 * 3600e3 ? 0.5 : 0;
  const score = t.w + (dir !== 'neutral' ? 1.5 : 0) + best.inTitle + recency + (item.relevance || 0);

  return {
    id: hash(item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
    title: item.title,
    url: item.url,
    source: item.source,
    time: new Date(item.time).toISOString(),
    topic: t.id,
    topicLabel: t.label,
    scheduled: t.scheduled,
    impact: dir,            // up | down | neutral  (arah EMAS)
    reason,
    summary: `${lead} ${tail}`,
    score: Math.round(score * 10) / 10,
    high: score >= 7,
  };
}

export function analyze(raw, now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!r.title || !r.time || now - r.time > WINDOW_MS || r.time > now + 3600e3) continue;
    const c = classify(r, now);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  out.sort((a, b) => new Date(b.time) - new Date(a.time));
  return out.slice(0, 40);
}

/* ───────────── Fetch helper ───────────── */
async function jget(url, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; AuriEcon/1.0)', accept: 'application/json' } });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* bukan JSON */ }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; e.body = j; throw e; }
    return j;
  } finally { clearTimeout(timer); }
}
const fail = (e) => ({ status: e && (e.status === 429 || e.body?.code === 'rateLimited') ? 'rate' : 'err', items: [] });

/* ───────────── Sumber berita ───────────── */
async function fromAlphaVantage(key, now) {
  if (!key) return { status: 'off', items: [] };
  try {
    const d = new Date(now - WINDOW_MS);
    const p = (n) => String(n).padStart(2, '0');
    const tf = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
    const j = await jget(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=economy_macro&time_from=${tf}&sort=LATEST&limit=60&apikey=${encodeURIComponent(key)}`);
    if (j.Information || j.Note) return { status: 'rate', items: [] };
    if (!Array.isArray(j.feed)) return { status: 'err', items: [] };
    return {
      status: 'ok',
      items: j.feed.map((a) => {
        const s = a.time_published || '';
        const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
        const rel = Math.max(0, ...(a.topics || []).map((x) => +x.relevance_score || 0));
        return { title: a.title, summary: a.summary, url: a.url, source: a.source, time: t, relevance: rel };
      }),
    };
  } catch (e) { return fail(e); }
}

async function fromFMP(key) {
  if (!key) return { status: 'off', items: [] };
  try {
    const j = await jget(`https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=60&apikey=${encodeURIComponent(key)}`);
    if (!Array.isArray(j)) return { status: 'err', items: [] };
    return {
      status: 'ok',
      items: j.map((a) => ({ title: a.title, summary: a.text, url: a.url, source: a.publisher || a.site, time: Date.parse(String(a.publishedDate).replace(' ', 'T') + 'Z') })),
    };
  } catch (e) { return fail(e); }
}

async function fromNewsAPI(key, now) {
  if (!key) return { status: 'off', items: [] };
  try {
    const q = encodeURIComponent('(inflation OR CPI OR "Federal Reserve" OR FOMC OR payrolls OR "gold price" OR "dollar index" OR "Treasury yields" OR geopolitical)');
    const from = new Date(now - WINDOW_MS).toISOString();
    const j = await jget(`https://newsapi.org/v2/everything?q=${q}&from=${from}&language=en&sortBy=publishedAt&pageSize=50&apiKey=${encodeURIComponent(key)}`);
    if (j.status !== 'ok') return { status: j.code === 'rateLimited' ? 'rate' : 'err', items: [] };
    return {
      status: 'ok',
      items: j.articles.map((a) => ({ title: a.title, summary: a.description, url: a.url, source: a.source?.name, time: Date.parse(a.publishedAt) })),
    };
  } catch (e) { return fail(e); }
}

/* ───────────── Pasar: emas, DXY, yield 10Y ───────────── */
async function yahoo(sym) {
  const j = await jget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error('no data');
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const price = r.meta?.regularMarketPrice ?? closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : r.meta?.chartPreviousClose;
  if (price == null || prev == null) throw new Error('no data');
  return { price, change: price - prev, pct: ((price - prev) / prev) * 100 };
}

async function twelveGold(key) {
  const j = await jget(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${encodeURIComponent(key)}`);
  const price = +j.close, prev = +j.previous_close;
  if (!Number.isFinite(price) || !Number.isFinite(prev)) throw new Error('no data');
  return { price, change: price - prev, pct: ((price - prev) / prev) * 100 };
}

async function market(twelveKey) {
  const safe = (p) => p.then((v) => v, () => null);
  let [gold, dxy, us10y] = await Promise.all([safe(yahoo('GC=F')), safe(yahoo('DX-Y.NYB')), safe(yahoo('^TNX'))]);
  if (!gold && twelveKey) gold = await safe(twelveGold(twelveKey));
  return { gold, dxy, us10y };
}

/* ───────────── Handler ───────────── */
const respond = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' },
});

export default async (req) => {
  const force = new URL(req.url).searchParams.get('force') === '1';
  const now = Date.now();
  if (cache && now - cache.t < (force ? 60e3 : TTL_MS)) return respond(cache.body);

  const env = process.env;
  const [av, fmp, na, mk] = await Promise.all([
    fromAlphaVantage(env.ALPHAVANTAGE_KEY, now),
    fromFMP(env.FMP_KEY),
    fromNewsAPI(env.NEWSAPI_KEY, now),
    market(env.TWELVEDATA_KEY),
  ]);

  const items = analyze([...av.items, ...fmp.items, ...na.items], now);
  const st = [av.status, fmp.status, na.status];
  let error = null;
  if (!items.length) {
    if (st.every((s) => s === 'off')) error = 'no_key';
    else if (st.includes('rate')) error = 'rate_limit';
    else if (!st.includes('ok')) error = 'upstream';
  }

  const body = {
    ok: !error,
    error,
    fetchedAt: new Date(now).toISOString(),
    items,
    market: mk,
    sources: { alphavantage: av.status, fmp: fmp.status, newsapi: na.status },
  };
  if (!error) cache = { t: now, body }; // jangan cache kegagalan
  return respond(body);
};
