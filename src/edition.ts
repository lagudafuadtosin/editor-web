// Which build this is. The Windows app has everything. The free web version (editor.postbarrel.com) is built from
// the same files with VITE_EDITION=web: it does the basics, and the rest shows as one "More in the free app" line
// in each menu that opens the download page.
export const IS_WEB = import.meta.env.VITE_EDITION === 'web'

export const DOWNLOAD_URL = 'https://github.com/lagudafuadtosin/editor-web/releases/latest'

export function openDownload() {
  window.open(DOWNLOAD_URL, '_blank', 'noopener')
}
