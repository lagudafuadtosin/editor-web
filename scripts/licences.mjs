// Writes src/licences.json: every package built into the app, with its licence and notice, for the About > Licences page.
// Run after changing packages: node scripts/licences.mjs
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const list = join(process.cwd(), 'node_modules', '.bundled-packages')
execSync('npx vite build --logLevel error', { stdio: 'inherit', env: { ...process.env, LIST_PACKAGES: list } })
const names = [...new Set(['page', 'worker'].flatMap((part) => existsSync(`${list}.${part}.json`) ? JSON.parse(readFileSync(`${list}.${part}.json`, 'utf8')) : []))].sort()

const out = names.map((name) => {
  const dir = join('node_modules', name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  return {
    name,
    version: pkg.version,
    licence: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'see text',
    url: (pkg.homepage || repo || `https://www.npmjs.com/package/${name}`).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:/, 'https:'),
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : '',
  }
})

writeFileSync(join('src', 'licences.json'), JSON.stringify(out, null, 1))
console.log(`${out.length} entries:`, out.map((o) => `${o.name} ${o.licence}`).join(', '))
