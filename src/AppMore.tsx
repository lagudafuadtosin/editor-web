import { openDownload } from './edition'

// The web version's one line in a panel for what that panel can do in the free app: it opens the download page.
export function AppMore({ what }: { what: string }) {
  return (
    <button type="button" className="app-more-line" onClick={openDownload} title="Opens the download page for the free app">
      <span>More in the free app: {what}</span>
      <span className="app-tag">Free app</span>
    </button>
  )
}
