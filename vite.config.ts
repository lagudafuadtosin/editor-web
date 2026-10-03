import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// With LIST_PACKAGES set, a build also writes which npm packages ended up inside it (scripts/licences.mjs uses it).
function listPackages(part: string): Plugin {
  return {
    name: 'list-packages',
    apply: 'build',
    generateBundle() {
      if (!process.env.LIST_PACKAGES) return
      const names = new Set<string>()
      for (const id of this.getModuleIds()) {
        const path = id.replace(/\\/g, '/')
        const at = path.lastIndexOf('node_modules/')
        if (at < 0) continue
        const m = /^((?:@[^/]+\/)?[^/]+)/.exec(path.slice(at + 'node_modules/'.length))
        if (m) names.add(m[1])
      }
      writeFileSync(`${process.env.LIST_PACKAGES}.${part}.json`, JSON.stringify([...names].sort(), null, 2))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), listPackages('page')],
  // Lets dev tests read files in ../editor/test-videos through /@fs/ (never shipped in a build).
  server: { fs: { allow: ['..'] }, port: 5181, strictPort: true },
})
