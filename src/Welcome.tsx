import { Download, Globe } from 'lucide-react'
import { openDownload } from './edition'

// Web version only: the first screen at editor.postbarrel.com. Download the free Windows app, or carry on in the browser.
export function Welcome({ onWeb }: { onWeb: () => void }) {
  return (
    <div className="home welcome">
      <div className="welcome-body">
        <img className="welcome-logo" src="/favicon.svg" alt="" />
        <h1>Postbarrel <b>Vid Editor</b></h1>
        <p className="welcome-sub">A free video editor and teleprompter for TikTok, Reels and Shorts. No account. Your files never leave your computer.</p>
        <div className="welcome-choices">
          <div className="welcome-card">
            <h2><Download size={20} /> The free app for Windows</h2>
            <p>Everything: captions, projects, MKV files from OBS and every format.</p>
            <button className="home-new" onClick={openDownload}><Download size={18} /> Download the app</button>
          </div>
          <div className="welcome-card">
            <h2><Globe size={20} /> The free web version</h2>
            <p>Edit MP4 and MOV videos right here in your browser. Nothing to install.</p>
            <button className="home-open" onClick={onWeb}><Globe size={16} /> Use it in the browser</button>
          </div>
        </div>
      </div>
    </div>
  )
}
