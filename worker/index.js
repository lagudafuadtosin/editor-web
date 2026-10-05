// The only server code of the web editor: an anonymous daily tally of how much it is used.
// POST /count with one of four words adds one to today's number for that word. Nothing else is
// read or kept: no IP address, no cookie, no id, nothing about the person or their files.
// Every other request is the static site, served as before.
const EVENTS = new Set(['visit', 'open', 'export', 'take'])
const ORIGIN = 'https://editor.postbarrel.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/count') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    if (request.headers.get('Origin') !== ORIGIN) return new Response(null, { status: 403 })
    const event = (await request.text()).slice(0, 10)
    if (!EVENTS.has(event)) return new Response(null, { status: 400 })
    const day = new Date().toISOString().slice(0, 10)
    await env.editor_usage
      .prepare('insert into counts (day, event, n) values (?1, ?2, 1) on conflict (day, event) do update set n = n + 1')
      .bind(day, event)
      .run()
    return new Response(null, { status: 204 })
  },
}
