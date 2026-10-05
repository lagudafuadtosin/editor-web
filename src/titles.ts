import { DEFAULT_TEXT, type TextStyle } from './text'
import { newId, type Clip, type Frame, type Transform } from './model'

// Ready-made titles. Each is one or more text and colour block clips, grouped so they move together,
// placed at the playhead on new layers. Every word is the person's to change.

export const TITLES: { id: string; name: string }[] = [
  { id: 'lower', name: 'Name and role (lower third)' },
  { id: 'big', name: 'Big title' },
  { id: 'subscribe', name: 'Subscribe button' },
  { id: 'quote', name: 'Quote' },
  { id: 'chapter', name: 'Chapter' },
  { id: 'place', name: 'Place tag' },
  { id: 'news', name: 'News bar' },
  { id: 'cta', name: 'Link in bio' },
]

const box = (f: Frame, x: number, y: number, w: number, h = 0): Transform => ({
  x: f.w * x, y: f.h * y, w: f.w * w, h: f.h * h, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: false,
  crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0,
})
const T = (s: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT, ...s })

// The clips of a title, bottom first. Each list item goes on its own layer.
export function makeTitle(id: string, f: Frame, len = 4): Clip[] {
  const group = newId('g')
  const text = (s: Partial<TextStyle>, tr: Transform, anim?: Clip['anim']): Clip => ({ id: newId('c'), kind: 'text', start: 0, in: 0, out: len, text: T(s), transform: tr, anim, group })
  const block = (color: string, tr: Transform, anim?: Clip['anim']): Clip => ({ id: newId('c'), kind: 'color', color, start: 0, in: 0, out: len, transform: tr, anim, group })
  switch (id) {
    case 'lower': return [
      block('#f5e642', box(f, 0.3, 0.8, 0.52, 0.075), { in: 'slide', out: 'fade', duration: 0.4 }),
      text({ text: 'Your Name', size: 64, color: '#111111', outlineWidth: 0, align: 'left' }, box(f, 0.3, 0.788, 0.48), { in: 'slide', out: 'fade', duration: 0.45 }),
      text({ text: 'What you do', size: 40, bold: false, color: '#ffffff', outlineWidth: 5, align: 'left' }, box(f, 0.3, 0.85, 0.48), { in: 'fade', out: 'fade', duration: 0.6 }),
    ]
    case 'big': return [text({ text: 'BIG TITLE', font: 'Impact', size: 170, outlineWidth: 10, bold: false }, box(f, 0.5, 0.45, 0.9), { in: 'zoom', out: 'fade', duration: 0.4, during: 'zoomIn' })]
    case 'subscribe': return [text({ text: 'SUBSCRIBE', size: 70, color: '#ffffff', outlineWidth: 0, background: true, backgroundColor: '#e11d2e', backgroundOpacity: 1 }, box(f, 0.5, 0.8, 0.55), { in: 'bounce', out: 'pop', duration: 0.5 })]
    case 'quote': return [
      text({ text: '“Your quote goes here, the words that matter.”', font: 'Georgia', italic: true, bold: false, size: 66, outlineWidth: 0, shadow: true }, box(f, 0.5, 0.45, 0.82), { in: 'fade', out: 'fade', duration: 0.8 }),
      text({ text: 'Who said it', font: 'Georgia', bold: false, size: 42, outlineWidth: 0, color: '#f5e642' }, box(f, 0.5, 0.58, 0.7), { in: 'fade', out: 'fade', duration: 1.2 }),
    ]
    case 'chapter': return [
      text({ text: 'CHAPTER 1', size: 40, bold: false, outlineWidth: 0, color: '#f5e642' }, box(f, 0.5, 0.44, 0.7), { in: 'fade', out: 'fade', duration: 0.6 }),
      text({ text: 'The beginning', size: 96, outlineWidth: 0, shadow: true }, box(f, 0.5, 0.5, 0.86), { in: 'slide', out: 'fade', duration: 0.6 }),
    ]
    case 'place': return [text({ text: '📍 Your place', size: 46, outlineWidth: 0, background: true, backgroundColor: '#000000', backgroundOpacity: 0.6, align: 'left' }, box(f, 0.33, 0.12, 0.6), { in: 'slide', out: 'fade', duration: 0.4 })]
    case 'news': return [
      block('#c8102e', box(f, 0.5, 0.86, 1, 0.07), { in: 'fade', out: 'fade', duration: 0.3 }),
      text({ text: 'BREAKING: your headline here', size: 46, outlineWidth: 0, uppercase: true }, box(f, 0.5, 0.86, 0.94), { in: 'slide', out: 'fade', duration: 0.4 }),
    ]
    default: return [text({ text: 'Link in bio 👇', size: 80, glow: true, outlineWidth: 6 }, box(f, 0.5, 0.78, 0.8), { in: 'pop', out: 'fade', duration: 0.4 })]
  }
}
