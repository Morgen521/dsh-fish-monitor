// dsh-fish-monitor · web half
// Sidebar entry「肥鱼监控」+ a full panel: live token usage of Aurabot's QQ
// sessions (from /fish/api) and her current mood (from /aurabot/api/state).

window.__ModuleLoader__.load({
  id: 'dsh-fish-monitor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useState, useEffect } = React
    const h = React.createElement
    const inject = ['slots']
    const PANEL_ID = 'fish-monitor'

    const get = (p) =>
      fetch(p, { cache: 'no-store' })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, message: '连不上：' + e.message }))

    const fmt = (n) => {
      const v = Number(n) || 0
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
      return String(Math.round(v))
    }
    const money = (n) => '¥' + (Number(n) || 0).toFixed(3)

    const card = { flex: '1 1 150px', minWidth: 140, padding: '12px 14px', borderRadius: 12, background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.08))' }
    const label = { fontSize: 12, opacity: 0.65, marginBottom: 4 }
    const big = { fontSize: 20, fontWeight: 600 }

    function Mood({ mood }) {
      if (!mood) return h('div', { style: { opacity: 0.6, fontSize: 13 } }, '读不到心情（Aurabot 可能没在运行）')
      const v = Number(mood.value) || 0
      const color = v >= 75 ? '#f2a33c' : v >= 45 ? '#3f9ee0' : '#7a86a8'
      const history = (mood.history || []).slice(-6).reverse()
      return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
          h('div', { style: { fontSize: 26, fontWeight: 700, color } }, String(Math.round(v))),
          h('div', { style: { fontSize: 14, opacity: 0.8 } }, mood.label || ''),
          h('div', { style: { fontSize: 12, opacity: 0.55, marginLeft: 'auto' } }, mood.reason ? '刚刚：' + mood.reason : '')
        ),
        h('div', { style: { height: 8, borderRadius: 4, background: 'rgba(127,127,127,0.18)', marginTop: 8, overflow: 'hidden' } },
          h('div', { style: { width: Math.max(2, Math.min(100, v)) + '%', height: '100%', background: color, transition: 'width .4s' } })
        ),
        history.length ? h('div', { style: { marginTop: 10, fontSize: 12, lineHeight: 1.7, opacity: 0.75 } },
          history.map((x, i) => h('div', { key: i },
            h('span', { style: { opacity: 0.55 } }, new Date(x.at).toLocaleTimeString() + '  '),
            h('span', null, `${x.from} → ${x.to}  `),
            h('span', { style: { opacity: 0.6 } }, x.reason || '')
          ))
        ) : null
      )
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [state, setState] = useState(null)
      const [err, setErr] = useState('')

      useEffect(() => {
        let alive = true
        const tick = async () => {
          const [a, b] = await Promise.all([get('/fish/api/state'), get('/aurabot/api/state')])
          if (!alive) return
          if (a && a.ok) { setData(a); setErr('') } else setErr((a && a.message) || '读取失败')
          if (b && b.ok) setState(b)
        }
        tick()
        const t = setInterval(tick, 5000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      if (!data) return h('div', { style: { padding: 24, opacity: 0.7 } }, err || '读取中…')

      const mood = state ? state.mood : null
      const sessions = data.sessions || []
      const maxRatio = sessions.reduce((m, s) => Math.max(m, s.ratio || 0), 0)

      return h('div', { style: { padding: '18px 22px', overflow: 'auto', height: '100%', fontSize: 13 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 } },
          h('div', { style: { fontSize: 18, fontWeight: 700 } }, '🐟 大肥鱼 · 实时监控'),
          h('div', { style: { fontSize: 12, opacity: 0.5 } }, '每 5 秒刷新 · 数据来自本机会话记录'),
          err ? h('div', { style: { marginLeft: 'auto', color: '#d9534f', fontSize: 12 } }, err) : null
        ),

        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 } },
          h('div', { style: card },
            h('div', { style: label }, '当前时段'),
            h('div', { style: { ...big, color: data.peakNow ? '#e08b2d' : '#3f9ee0' } }, data.peakNow ? '高峰 ×2' : '空闲 ×1')),
          h('div', { style: card }, h('div', { style: label }, '今日 tokens'), h('div', { style: big }, fmt(data.today.tokens))),
          h('div', { style: card }, h('div', { style: label }, '累计 tokens'), h('div', { style: big }, fmt(data.total.tokens))),
          h('div', { style: card }, h('div', { style: label }, '今日花费'), h('div', { style: big }, money(data.today.cost))),
          h('div', { style: card }, h('div', { style: label }, '累计花费'), h('div', { style: big }, money(data.total.cost))),
          h('div', { style: card }, h('div', { style: label }, '最高上下文占用'), h('div', { style: big }, (maxRatio * 100).toFixed(0) + '%'))
        ),

        h('div', { style: { borderRadius: 12, padding: '14px 16px', marginBottom: 16, background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.08))' } },
          h('div', { style: { ...label, fontSize: 13, marginBottom: 8 } }, '心理状况'),
          h(Mood, { mood })
        ),

        h('div', { style: { ...label, fontSize: 13, marginBottom: 8 } }, '按会话明细'),
        h('div', { style: { border: '1px solid rgba(127,127,127,0.18)', borderRadius: 12, overflow: 'hidden' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.4fr', gap: 8, padding: '10px 14px', fontSize: 12, opacity: 0.6, background: 'rgba(127,127,127,0.06)' } },
            h('div', null, '会话'), h('div', null, '累计 tokens'), h('div', null, '今日花费'), h('div', null, '累计花费'), h('div', null, '上下文')
          ),
          sessions.length ? sessions.map((s) =>
            h('div', { key: s.id, style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.4fr', gap: 8, padding: '10px 14px', borderTop: '1px solid rgba(127,127,127,0.12)', alignItems: 'center' } },
              h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: s.title }, s.title),
              h('div', null, fmt(s.tokens)),
              h('div', null, money(s.todayCost)),
              h('div', null, money(s.totalCost)),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('div', { style: { flex: 1, height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.18)', overflow: 'hidden' } },
                  h('div', { style: { width: Math.min(100, (s.ratio || 0) * 100) + '%', height: '100%', background: s.ratio > 0.75 ? '#d9534f' : '#3f9ee0' } })
                ),
                h('div', { style: { fontSize: 11, opacity: 0.6, width: 34, textAlign: 'right' } }, ((s.ratio || 0) * 100).toFixed(0) + '%')
              )
            )
          ) : h('div', { style: { padding: 16, opacity: 0.6 } }, '还没有 QQ 会话数据')
        ),

        h('div', { style: { marginTop: 14, fontSize: 11, opacity: 0.5, lineHeight: 1.7 } },
          `官方价（元/百万 tokens）· 空闲：缓存命中 ¥${data.prices.off.cacheHit}、未命中 ¥${data.prices.off.cacheMiss}、输出 ¥${data.prices.off.output}；`,
          h('br'),
          `高峰（工作日 9:00–12:00、14:00–18:00 北京时间）：命中 ¥${data.prices.peak.cacheHit}、未命中 ¥${data.prices.peak.cacheMiss}、输出 ¥${data.prices.peak.output}。`,
          h('br'),
          '费用按每 30 秒采样到的用量增量、以当时的时段价格累计；节假日按空闲价。'
        )
      )
    }

    function FishIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' },
        h('path', { d: 'M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6z', fill: 'currentColor', opacity: 0.85 }),
        h('circle', { cx: 8.5, cy: 11, r: 1.2, fill: '#fff' })
      )
    }

    function apply(ctx) {
      const slots = ctx.slots !== undefined ? ctx.slots : typeof ctx.get === 'function' ? ctx.get('slots') : undefined
      if (slots === undefined) return
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel))
      slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => '肥鱼监控' }, FishIcon))
    }

    exports.apply = apply
    exports.inject = inject
    exports.Panel = Panel
    return module.exports
  },
})
