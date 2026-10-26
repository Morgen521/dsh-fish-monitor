/**
 * dsh-fish-monitor — host half.
 *
 * Token accounting with DeepSeek's peak/off-peak pricing:
 *   peak = Beijing time, Mon-Fri, 09:00-12:00 and 14:00-18:00, excluding holidays
 *   off  = everything else (nights, weekends, statutory holidays)
 *   price per 1M tokens (CNY), off / peak:
 *     cache hit 0.02 / 0.04 · cache miss 1 / 2 · output 4 / 8
 *
 * DSH usage counters are cumulative, so a sampler diffs them every 30s and
 * charges the delta at the price in effect at sample time. Accumulators are
 * persisted so restarts do not lose them.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'fish-monitor'
export const inject = ['webServer']

const PREFIX = '/fish/api'
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CACHE_DIR = join(HOME, 'storages', 'session_projcache', 'sessions')
const STATE_DIR = join(HOME, 'fish-monitor')
const COST_FILE = join(STATE_DIR, 'cost.json')
const HOLIDAY_FILE = join(STATE_DIR, 'holidays.json')
const AURABOT_WORKSPACE = 'qq-chats'
const SAMPLE_MS = 30_000

const PRICES = {
  off: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
}

/**
 * 2026 大陆法定节假日（只看放假日；调休上班日按周末处理，规则里周末本来就是空闲）。
 * 官方安排不同的话，改 $DSH_HOME/fish-monitor/holidays.json：
 *   { "days": ["2026-01-01", ...] }
 */
const DEFAULT_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]

function holidays() {
  try {
    const doc = JSON.parse(readFileSync(HOLIDAY_FILE, 'utf8'))
    if (Array.isArray(doc.days)) return new Set(doc.days)
  } catch (e) {}
  return new Set(DEFAULT_HOLIDAYS)
}

const pad = (n) => String(n).padStart(2, '0')

/** Beijing date/time parts for an instant (China has no DST). */
function beijing(now) {
  const d = new Date(now + 8 * 3600 * 1000)
  return {
    day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

function isPeak(now) {
  const b = beijing(now)
  if (b.weekday === 0 || b.weekday === 6) return false
  if (holidays().has(b.day)) return false
  const m = b.minutes
  return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60)
}

function loadCost() {
  try {
    const doc = JSON.parse(readFileSync(COST_FILE, 'utf8'))
    if (doc && doc.prev) return doc
  } catch (e) {}
  return { day: beijing(Date.now()).day, todayCost: 0, totalCost: 0, peakTokens: 0, offTokens: 0, prev: {}, sess: {} }
}

function saveCost(doc) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(COST_FILE, JSON.stringify(doc))
  } catch (e) {}
}

function readSessions() {
  const out = []
  let names = []
  try {
    names = readdirSync(CACHE_DIR).filter((n) => n.endsWith('.json'))
  } catch (e) {
    return out
  }
  for (const name of names) {
    try {
      const doc = JSON.parse(readFileSync(join(CACHE_DIR, name), 'utf8'))
      const rows = doc.record?.rows || {}
      const identity = doc.identity || {}
      const title = rows.title?.val || '(未命名)'
      const cwd = String(identity.cwd || '')
      if (!cwd.includes(AURABOT_WORKSPACE) && !/^QQ[ ·]/.test(String(title))) continue
      const t = rows.tokenUsage?.val?.totals || {}
      const p = rows.contextPressure?.val || {}
      out.push({
        id: name.replace(/\.json$/, ''),
        title: String(title).slice(0, 40),
        input: Number(t.uncachedInputTokens) || 0,
        output: Number(t.outputTokens) || 0,
        cacheRead: Number(t.cacheReadTokens) || 0,
        pressure: Number(p.pressureTokens) || 0,
        window: Number(p.contextWindow) || 0,
      })
    } catch (e) {}
  }
  return out
}

function charge(acc, s, price) {
  const prev = acc.prev[s.id]
  if (!prev) {
    acc.prev[s.id] = { input: s.input, output: s.output, cacheRead: s.cacheRead }
    return { input: 0, output: 0, cacheRead: 0, cost: 0 }
  }
  const dIn = Math.max(0, s.input - prev.input)
  const dOut = Math.max(0, s.output - prev.output)
  const dCache = Math.max(0, s.cacheRead - prev.cacheRead)
  acc.prev[s.id] = { input: s.input, output: s.output, cacheRead: s.cacheRead }
  const cost = (dIn / 1e6) * price.cacheMiss + (dOut / 1e6) * price.output + (dCache / 1e6) * price.cacheHit
  return { input: dIn, output: dOut, cacheRead: dCache, cost }
}

function sample() {
  const now = Date.now()
  const acc = loadCost()
  const day = beijing(now).day
  if (acc.day !== day) {
    acc.day = day
    acc.todayCost = 0
    acc.sess = Object.fromEntries(Object.entries(acc.sess || {}).map(([k, v]) => [k, { ...v, todayCost: 0 }]))
  }
  const peak = isPeak(now)
  const price = peak ? PRICES.peak : PRICES.off
  for (const s of readSessions()) {
    const d = charge(acc, s, price)
    acc.todayCost += d.cost
    acc.totalCost += d.cost
    if (peak) acc.peakTokens += d.input + d.output
    else acc.offTokens += d.input + d.output
    const prev = acc.sess[s.id] || { todayCost: 0, totalCost: 0 }
    prev.todayCost += d.cost
    prev.totalCost += d.cost
    acc.sess[s.id] = prev
  }
  saveCost(acc)
  return acc
}

let timer = null

function build() {
  const now = Date.now()
  const acc = sample()
  const day = beijing(now).day
  let tokens = 0
  let todayTokens = 0
  let todayCost = 0
  let totalCost = 0
  const views = readSessions().map((s) => {
    const mine = acc.sess[s.id] || { todayCost: 0, totalCost: 0 }
    const t = s.input + s.output
    tokens += t
    todayTokens += t
    todayCost += mine.todayCost
    totalCost += mine.totalCost
    return { ...s, tokens: t, todayCost: mine.todayCost, totalCost: mine.totalCost, ratio: s.window > 0 ? s.pressure / s.window : 0 }
  })
  return {
    ok: true,
    updatedAt: now,
    day,
    peakNow: isPeak(now),
    prices: PRICES,
    today: { tokens: todayTokens, cost: todayCost },
    total: { tokens, cost: totalCost, peakTokens: acc.peakTokens, offTokens: acc.offTokens },
    sessions: views,
  }
}

export function apply(ctx) {
  timer = setInterval(() => {
    try { sample() } catch (e) {}
  }, SAMPLE_MS)
  ctx.effect(() => () => { if (timer) clearInterval(timer) }, 'fish-monitor: sampler')

  const route = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: PREFIX + path,
      handler: async (req, res) => {
        try {
          const body = await handler(req, res)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        } catch (error) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ ok: false, message: String(error && error.message ? error.message : error) }))
        }
      },
    }), `fish-monitor: ${path}`)

  route('/state', async () => build())
  route('/reset', async () => {
    saveCost({ day: beijing(Date.now()).day, todayCost: 0, totalCost: 0, peakTokens: 0, offTokens: 0, prev: {}, sess: {} })
    return { ok: true }
  })
}
