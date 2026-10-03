import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DOWNLOAD_URL } from './gate'

// The editor needs Chrome or Edge on a computer: picking and saving files on the disk, and the browser's own
// video encoding. Anywhere else people get a clear page instead of a broken editor.
function supported(): boolean {
  const w = window as unknown as Record<string, unknown>
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  return !phone && 'showOpenFilePicker' in w && 'showSaveFilePicker' in w && 'VideoEncoder' in w && 'AudioEncoder' in w && 'VideoDecoder' in w
}

function Unsupported() {
  return (
    <div className="unsupported">
      <img src="/favicon.svg" alt="" />
      <h1>Postbarrel <b>Vid Editor</b></h1>
      <p>The free web editor runs in <b>Chrome</b> or <b>Microsoft Edge</b> on a computer.</p>
      <p>Open this page in one of those, or <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">get the free app for Windows</a>.</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supported() ? <App /> : <Unsupported />}
  </StrictMode>,
)
