import type { MenuItem } from './ContextMenu'

// In the Picture tab nothing moves or plays, so menu items about time are left out.
const TIMED = [
  /^Freeze/, /^Render/, /^Nest|nested timeline/i, /^Sync/, /^Cut between/, /viewer/, /^Reverse/, /scene changes/, /beats/, /keyframes/i,
  /marker/i, /close the gap/i, /^Close this gap/, /^Animation$/, /^Transition/, /^Stabilise/, /^Track something/, /Follow what is tracked/,
  /^Sound effect/, /^Volume line/, /^Record/, /preview copies/, /Lottie/, /^Countdown/, /^Credits/, /timeline/i, /Loudness/, /voiceover/,
  /sound track/i, /^Delete and close the gap/, /^Slideshow/,
]

export function pictureMenu(items: MenuItem[]): MenuItem[] {
  const kept = items.filter((it) => it === 'line' || !TIMED.some((r) => r.test(it.label)))
  const tidy = kept.filter((it, i, a) => it !== 'line' || (i > 0 && a[i - 1] !== 'line'))
  while (tidy[0] === 'line') tidy.shift()
  while (tidy[tidy.length - 1] === 'line') tidy.pop()
  return tidy
}
