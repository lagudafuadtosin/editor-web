import type { TextStyle } from './text'

// Ready-made looks. Picking one keeps your words and size, and replaces the rest of the look.
export const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: 'Classic', style: { font: 'Arial', bold: true, italic: false, color: '#ffffff', outlineColor: '#000000', outlineWidth: 8, background: false, shadow: false, glow: false, uppercase: false } },
  { name: 'Box', style: { font: 'Arial', bold: true, italic: false, color: '#ffffff', outlineWidth: 0, background: true, backgroundColor: '#000000', backgroundOpacity: 0.65, shadow: false, glow: false, uppercase: false } },
  { name: 'Yellow caption', style: { font: 'Arial', bold: true, italic: false, color: '#facc15', outlineColor: '#000000', outlineWidth: 9, background: false, shadow: false, glow: false, uppercase: false } },
  { name: 'Shadow', style: { font: 'Verdana', bold: true, italic: false, color: '#ffffff', outlineWidth: 0, background: false, shadow: true, glow: false, uppercase: false } },
  { name: 'Highlight', style: { font: 'Arial', bold: true, italic: false, color: '#111111', outlineWidth: 0, background: true, backgroundColor: '#facc15', backgroundOpacity: 1, shadow: false, glow: false, uppercase: false } },
  { name: 'Neon', style: { font: 'Trebuchet MS', bold: true, italic: false, color: '#22d3ee', outlineColor: '#ffffff', outlineWidth: 2, background: false, shadow: false, glow: true, uppercase: false } },
  { name: 'Meme', style: { font: 'Impact', bold: false, italic: false, color: '#ffffff', outlineColor: '#000000', outlineWidth: 10, background: false, shadow: false, glow: false, uppercase: true } },
  { name: 'Elegant', style: { font: 'Georgia', bold: false, italic: true, color: '#fef3c7', outlineWidth: 0, background: false, shadow: true, glow: false, uppercase: false } },
]
