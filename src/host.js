/**
 * dsh-fish-monitor — host half.
 *
 * Reads DSH's per-session projection files (token usage + context pressure) and
 * exposes them as a small JSON API for the client panel. Aurabot's own sessions
 * live under the QQ workspace, so they are selected by cwd/title.
 *
 * Also keeps a per-day baseline so the panel can show "today" instead of the
 * session-lifetime totals, and a short ring buffer for the live rate.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'fish-monitor'
export const inject = ['webServer']

const PREFIX = '/fish/api'
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CACHE_DIR = join(HOME, 'storages', 'session_projcache', 'sessions')
const STATE_DIR = join(HOME, 'fish-monitor')
const STATE_FILE = join(STATE_DIR, 'baseline.json')
const AURABOT_WORKSPACE = 'qq-chats'

/** Rough CNY per 1M tokens (deepseek-flash). Labelled as an estimate in the UI. */
const RATES = { input: 0.5, output: 2, cacheRead: 0.1 }

const samples = []
const MAX_SAMPLES = 120

function localDay() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function loadBaseline() {
  try {
    const doc = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (doc.day === localDay() && doc.sessions) return doc
  } catch (e) {}
  return { day: localDay(), sessions: {} }
}

function saveBaseline(doc) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(doc))
  } catch (e) {}
}

function isAurabotSession(cwd, title) {
  return String(cwd || '').includes(AURABOT_WORKSPACE) || /^QQ[ ·]/.test(String(title || ''))
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
      if (!isAurabotSession(identity.cwd, title)) continue
      const t = rows.tokenUsage?.val?.totals || {}
      const p = rows.contextPressure?.val || {}
      const last = rows.tokenUsage?.val?.last?.buckets || {}
      out.push({
        id: name.replace(/\.json$/, ''),
        title: String(title).slice(0, 40),
        input: Number(t.uncachedInputTokens) || 0,
        output: Number(t.outputTokens) || 0,
        cacheRead: Number(t.cacheReadTokens) || 0,
        pressure: Number(p.pressureTokens) || 0,
        window: Number(p.contextWindow) || 0,
        lastInput: Number(last.uncachedInputTokens) || 0,
        lastOutput: Number(last.outputTokens) || 0,
      })
    } catch (e) {}
  }
  return out.sort((a, b) => b.input + b.output - (a.input + a.output))
}

function costOf(s) {
  return (s.input / 1e6) * RATES.input + (s.output / 1e6) * RATES.output + (s.cacheRead / 1e6) * RATES.cacheRead
}

function build() {
  const sessions = readSessions()
  const baseline = loadBaseline()
  const now = Date.now()
  let totalInput = 0
  let totalOutput = 0
  let totalCache = 0
  let todayCost = 0
  let todayTokens = 0

  const views = sessions.map((s) => {
    const prev = baseline.sessions[s.id]
    if (!prev) {
      baseline.sessions[s.id] = { input: s.input, output: s.output, cacheRead: s.cacheRead }
    }
    const base = baseline.sessions[s.id] || { input: s.input, output: s.output, cacheRead: s.cacheRead }
    const dInput = Math.max(0, s.input - base.input)
    const dOutput = Math.max(0, s.output - base.output)
    const dCache = Math.max(0, s.cacheRead - base.cacheRead)
    const cost = (dInput / 1e6) * RATES.input + (dOutput / 1e6) * RATES.output + (dCache / 1e6) * RATES.cacheRead
    totalInput += s.input
    totalOutput += s.output
    totalCache += s.cacheRead
    todayCost += cost
    todayTokens += dInput + dOutput
    return {
      ...s,
      todayInput: dInput,
      todayOutput: dOutput,
      todayCache: dCache,
      todayCost: cost,
      cost: costOf(s),
      ratio: s.window > 0 ? s.pressure / s.window : 0,
    }
  })

  saveBaseline(baseline)
  samples.push({ t: now, tokens: todayTokens })
  while (samples.length > MAX_SAMPLES) samples.shift()
  const recent = samples.filter((x) => now - x.t <= 5 * 60 * 1000)
  const rate = recent.length > 1 ? (recent[recent.length - 1].tokens - recent[0].tokens) / ((now - recent[0].t) / 60000) : 0

  return {
    ok: true,
    updatedAt: now,
    day: baseline.day,
    rates: RATES,
    today: { input: views.reduce((a, v) => a + v.todayInput, 0), output: views.reduce((a, v) => a + v.todayOutput, 0), tokens: todayTokens, cost: todayCost },
    total: { input: totalInput, output: totalOutput, cacheRead: totalCache, cost: views.reduce((a, v) => a + v.cost, 0) },
    ratePerMin: Math.max(0, rate),
    sessions: views,
  }
}

export function apply(ctx) {
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
    saveBaseline({ day: localDay(), sessions: {} })
    return { ok: true }
  })
}
