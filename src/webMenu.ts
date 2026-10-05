import { moreInApp, type MenuItem } from './ContextMenu'
import { openDownload } from './edition'

// The web version's menus: only the basics stay, and everything else becomes one line at the bottom,
// "More in the free app: freeze frame, nesting, multicam…", which opens the download page.

// What works on the web, by menu label.
const KEEP = new Set([
  // clip, row, track and marker menus
  'Add marker at the playhead', 'Delete', 'Delete and close the gap', 'Close this gap', 'Add marker here',
  'Lock', 'Mute', 'Solo', 'Hide', 'Change the note…', 'Add a note…', 'Move it to the playhead', 'Delete marker',
  // the arrows on the left rail
  'Add video, picture or sound…', 'Slideshow from photos…', 'Text', 'Colour block', 'Rectangle', 'Circle', 'Triangle', 'Star', 'Line', 'Arrow', 'Speech bubble',
  'New empty layer', 'New empty sound track', 'Emoji and stickers…', 'Draw…',
  // + Add
  'Animation', 'Transition from the clip before', 'Colour look', 'Blurred fill behind it',
  // the timelines menu: the one timeline there is
  'Main edit',
])

// Short names for what the free app adds, for the one line.
const SHORT: [RegExp, string][] = [
  [/^Freeze/, 'freeze frame'], [/^Replace/, 'replace clip'], [/^Render/, 'smooth playback'], [/^Nest|nested timeline/i, 'nesting'],
  [/^Sync/, 'sync by sound'], [/^Cut between/, 'multicam'], [/viewer/, 'viewer'], [/^Reverse/, 'reverse'], [/scene changes/, 'scene split'],
  [/beats/, 'beat markers'], [/effects$/, 'copy effects'], [/keyframes$/, 'copy keyframes'], [/^Group|^Ungroup/, 'grouping'],
  [/^Media list/, 'media list'], [/Lottie/, 'Lottie animations'], [/Record the screen/, 'screen recorder'], [/preview copies/, 'preview copies'],
  [/Title templates/, 'title templates'], [/brand|logo|Brand kit/i, 'brand kit'], [/Countdown/, 'countdown'], [/Credits/, 'credits'],
  [/Adjustment/, 'adjustment layer'], [/Picture in picture|Side by side|Top and bottom|Three stacked/, 'split screen'], [/voiceover/, 'voiceover'],
  [/Loudness/, 'loudness'], [/^Effect$/, 'effects'], [/Green screen/, 'green screen'], [/Stabilise/, 'stabilise'],
  [/Track something|Follow what is tracked/, 'tracking'], [/^Mask$/, 'masks'], [/Track matte/, 'track matte'], [/Blend/, 'blend modes'],
  [/Shadow and glow/, 'shadow and glow'], [/^Keyframes$/, 'keyframes'], [/Sound effect/, 'sound effects'], [/Volume line/, 'volume line'],
  [/timeline/i, 'more than one timeline'],
]
const shortName = (label: string) => SHORT.find(([r]) => r.test(label))?.[1] ?? label.replace(/…$/, '').toLowerCase()

export function webMenu(items: MenuItem[]): MenuItem[] {
  const kept: MenuItem[] = []
  const gone: string[] = []
  for (const it of items) {
    if (it === 'line') kept.push(it)
    else if (KEEP.has(it.label)) kept.push(it)
    else if (!/^Nothing to add/.test(it.label)) {
      const n = shortName(it.label)
      if (!gone.includes(n)) gone.push(n)
    }
  }
  // No line at the start or end, and never two together.
  const tidy = kept.filter((it, i, a) => it !== 'line' || (i > 0 && a[i - 1] !== 'line'))
  while (tidy[0] === 'line') tidy.shift()
  while (tidy[tidy.length - 1] === 'line') tidy.pop()
  if (!gone.length) return tidy
  const what = gone.slice(0, 4).join(', ') + (gone.length > 4 ? '…' : '')
  return [...tidy, ...(tidy.length ? ['line' as const] : []), moreInApp(what, openDownload)]
}
