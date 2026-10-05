// The only server code of the web editor: an anonymous daily tally of how much it is used, and a
// daily email of that tally to the owner.
//
// POST /count with one of five words adds one to today's number for that word. Nothing else is
// read or kept: no IP address, no cookie, no id, nothing about the person or their files.
// Every other request is the static site, served as before.
const EVENTS = {
  edit: 'Editing sessions (a video, sound or picture added)',
  export: 'Videos exported',
  take: 'Teleprompter takes recorded',
  picture: 'Picture tab sessions (a photo added)',
  still: 'Pictures saved',
}
const ORIGIN = 'https://editor.postbarrel.com'
const OWNER = 'lagudafuad@gmail.com'
const FROM = 'Postbarrel Vid Editor <hello@postbarrel.com>'

async function count(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  if (request.headers.get('Origin') !== ORIGIN) return new Response(null, { status: 403 })
  const event = (await request.text()).slice(0, 10)
  if (!(event in EVENTS)) return new Response(null, { status: 400 })
  const day = new Date().toISOString().slice(0, 10)
  await env.editor_usage
    .prepare('insert into counts (day, event, n) values (?1, ?2, 1) on conflict (day, event) do update set n = n + 1')
    .bind(day, event)
    .run()
  return new Response(null, { status: 204 })
}

// This month's numbers and the numbers since counting started, as one plain email.
async function report(env) {
  const now = new Date()
  const month = now.toISOString().slice(0, 7)
  const monthName = now.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const { results } = await env.editor_usage
    .prepare("select event, sum(case when substr(day, 1, 7) = ?1 then n else 0 end) as month_n, sum(n) as total from counts where event != 'visit' group by event")
    .bind(month)
    .all()
  const by = Object.fromEntries((results ?? []).map((r) => [r.event, r]))
  const rows = Object.entries(EVENTS).map(([k, label]) => [label, by[k]?.month_n ?? 0, by[k]?.total ?? 0])
  const since = '5 October 2026'
  const text = [
    `Postbarrel Vid Editor, free web version (editor.postbarrel.com)`,
    '',
    ...rows.map(([label, m, t]) => `${label}: ${m} in ${monthName}, ${t} since ${since}`),
    '',
    'Counted anonymously: no visits, no names, nothing about the people or their files.',
  ].join('\n')
  const cell = 'padding:6px 10px;border-bottom:1px solid #ddd'
  const html = `<p>Postbarrel Vid Editor, free web version (editor.postbarrel.com)</p>
<table style="border-collapse:collapse;font:14px system-ui,sans-serif">
<tr><th style="${cell};text-align:left">What</th><th style="${cell}">${monthName}</th><th style="${cell}">Since ${since}</th></tr>
${rows.map(([label, m, t]) => `<tr><td style="${cell}">${label}</td><td style="${cell};text-align:right">${m}</td><td style="${cell};text-align:right">${t}</td></tr>`).join('\n')}
</table>
<p style="color:#666;font-size:12px">Counted anonymously: no visits, no names, nothing about the people or their files.</p>`
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [OWNER], subject: `Vid Editor use, ${now.toISOString().slice(0, 10)}`, text, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/count') return count(request, env)
    return env.ASSETS.fetch(request)
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(report(env))
  },
}
