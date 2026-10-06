import { AudioBufferSink } from 'mediabunny'
import type { AsrMessage, AsrRequest } from './asr.worker'
import { device as findDevice, ensureCaptionModel, type Device } from './models'
import { DEFAULT_TEXT, type TextStyle } from './text'
import { addTrack, layout, newId, speedOf, type Clip, type Frame, type Project, type Source } from './model'

export type Word = { text: string; start: number; end: number } // timeline seconds
export type Line = { text: string; start: number; end: number; words?: { text: string; start: number; end: number }[] }

const RATE = 16000 // Whisper listens at 16 kHz, one channel

// The sound of a clip from in to out, as one 16 kHz channel.
async function clipAudio(source: Source, inPoint: number, outPoint: number): Promise<Float32Array> {
  const track = source.media.audioTrack
  if (!track) return new Float32Array(0)
  const len = Math.max(1, Math.round((outPoint - inPoint) * RATE))
  const mix = new OfflineAudioContext(1, len, RATE) // mixes to one channel and converts the rate
  for await (const { buffer, timestamp, duration } of new AudioBufferSink(track).buffers(inPoint, outPoint)) {
    const cutStart = Math.max(timestamp, inPoint)
    const cutEnd = Math.min(timestamp + duration, outPoint)
    if (cutEnd <= cutStart) continue
    const node = mix.createBufferSource()
    node.buffer = buffer
    node.connect(mix.destination)
    node.start(cutStart - inPoint, cutStart - timestamp, cutEnd - cutStart)
  }
  return (await mix.startRendering()).getChannelData(0)
}

let worker: Worker | null = null
let nextJob = 1

function transcribe(audio: Float32Array, model: 'fast' | 'accurate', device: Device, language: string | null, onProgress: (m: AsrMessage) => void): Promise<{ text: string; start: number; end: number }[]> {
  if (!worker) worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
  const id = nextJob++
  return new Promise((resolve, reject) => {
    const w = worker!
    const listen = (e: MessageEvent<AsrMessage>) => {
      if (e.data.id !== id) return
      if (e.data.type === 'done') {
        w.removeEventListener('message', listen)
        resolve(e.data.words)
      } else if (e.data.type === 'error') {
        w.removeEventListener('message', listen)
        reject(new Error(e.data.message))
      } else onProgress(e.data)
    }
    w.addEventListener('message', listen)
    w.postMessage({ id, model, device, language, audio } satisfies AsrRequest, [audio.buffer])
  })
}

export type CaptionProgress = { stage: 'download'; fraction: number } | { stage: 'listening'; done: number; total: number }

// Listens to each clip and returns every word with its time on the timeline.
export async function wordsFor(
  sources: Source[],
  clips: { clip: Clip; start: number }[],
  model: 'fast' | 'accurate',
  language: string | null,
  onProgress: (p: CaptionProgress) => void,
): Promise<Word[]> {
  const words: Word[] = []
  let i = 0
  // The model first: the app downloads it by name if this PC does not have it yet (only the files this PC uses).
  let dev = await findDevice()
  const download = (loaded: number, total: number) => onProgress({ stage: 'download', fraction: total ? loaded / total : 0 })
  await ensureCaptionModel(model, dev, download)
  for (const { clip, start } of clips) {
    const source = sources.find((s) => s.id === clip.sourceId)
    if (!source?.media.audioTrack) continue
    const audio = await clipAudio(source, clip.in, clip.out)
    const listen = () =>
      transcribe(audio.slice(), model, dev, language, (m) => {
        if (m.type === 'loading') download(m.loaded, m.total)
        if (m.type === 'working') onProgress({ stage: 'listening', done: i, total: clips.length })
      })
    let found: { text: string; start: number; end: number }[]
    try {
      found = await listen()
    } catch (err) {
      // The graphics card can fail mid-way (a lost or busy card throws "reading 'destroy'"). Start a fresh
      // thread and finish on the processor instead, which is slower but always there.
      if (dev.device !== 'webgpu') throw err
      worker?.terminate()
      worker = null
      dev = { device: 'wasm', f16: false }
      await ensureCaptionModel(model, dev, download)
      found = await listen()
    }
    const sp = speedOf(clip) // a sped-up clip says its words sooner on the timeline
    for (const w of found) words.push({ text: w.text, start: start + w.start / sp, end: start + Math.max(w.end, w.start + 0.05) / sp })
    i++
    onProgress({ stage: 'listening', done: i, total: clips.length })
  }
  return words
}

// Groups words into short caption lines: a few words each, broken at pauses and at the ends of sentences.
export function toLines(words: Word[], maxChars = 32, maxSeconds = 3): Line[] {
  const lines: Line[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    lines.push({
      text: cur.map((w) => w.text).join('').trim().replace(/\s+/g, ' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      // Each word's timing, kept for word-by-word captions. A word with no letters (a lone dash) is dropped.
      words: cur.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end })),
    })
    cur = []
  }
  for (const w of words) {
    if (cur.length) {
      const text = cur.map((x) => x.text).join('') + w.text
      const pause = w.start - cur[cur.length - 1].end
      const endsSentence = /[.!?]["')\]]?$/.test(cur[cur.length - 1].text.trim())
      if (text.trim().length > maxChars || w.end - cur[0].start > maxSeconds || pause > 0.5 || endsSentence) flush()
    }
    cur.push(w)
  }
  flush()
  // Each line stays up until the next one starts (if the gap is short), so captions do not flicker.
  for (let i = 0; i < lines.length - 1; i++) if (lines[i + 1].start - lines[i].end < 0.3) lines[i].end = lines[i + 1].start
  return lines
}

export const CAPTION_STYLE: TextStyle = { ...DEFAULT_TEXT, text: '', size: 72, outlineWidth: 9 }

// Puts the lines on a new top layer as text clips that share one caption group.
export function addCaptionLayer(p: Project, frame: Frame, lines: Line[]): { project: Project; firstId: string | null } {
  const group = newId('cap')
  const withTrack = addTrack(p, 'video')
  const top = withTrack.video.length - 1
  const clips: Clip[] = lines.map((l) => ({
    id: newId('c'),
    kind: 'text',
    caption: group,
    text: { ...CAPTION_STYLE, text: l.text },
    transform: { x: frame.w / 2, y: frame.h * 0.72, w: frame.w * 0.86, h: 0, rotation: 0, opacity: 1, flipH: false, flipV: false, keepRatio: true, crop: { t: 0, b: 0, l: 0, r: 0 }, feather: 0 },
    start: l.start,
    in: 0,
    out: Math.max(0.2, l.end - l.start),
    words: l.words?.map((w) => ({ text: w.text, start: w.start - l.start, end: w.end - l.start })),
  }))
  return {
    project: { ...withTrack, video: withTrack.video.map((t, i) => (i === top ? { ...t, clips } : t)) },
    firstId: clips[0]?.id ?? null,
  }
}

export function captionLines(p: Project, group: string) {
  return layout(p).filter((pl) => pl.clip.caption === group).sort((a, b) => a.start - b.start)
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

// The standard subtitle file TikTok, YouTube and every player read.
export function toSrt(p: Project, group: string): string {
  return captionLines(p, group)
    .map((pl, i) => `${i + 1}\n${srtTime(pl.start)} --> ${srtTime(pl.end)}\n${pl.clip.text?.text ?? ''}\n`)
    .join('\n')
}

// The web's subtitle file (YouTube and web players read it too).
export function toVtt(p: Project, group: string): string {
  const t = (x: number) => srtTime(x).replace(',', '.')
  return 'WEBVTT\n\n' + captionLines(p, group)
    .map((pl) => `${t(pl.start)} --> ${t(pl.end)}\n${pl.clip.text?.text ?? ''}\n`)
    .join('\n')
}

// Reads an .srt or .vtt subtitle file into caption lines.
export function fromSubtitles(text: string): Line[] {
  const time = (s: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s.trim())
    if (!m) return NaN
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
  }
  const lines: Line[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = block.split('\n').filter((r) => r.trim() && r.trim() !== 'WEBVTT')
    const at = rows.findIndex((r) => r.includes('-->'))
    if (at < 0) continue
    const [a, b] = rows[at].split('-->')
    const start = time(a)
    const end = time(b.split(/\s+/).filter(Boolean)[0] ?? '')
    const words = rows.slice(at + 1).join('\n').replace(/<[^>]+>/g, '').trim()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && words) lines.push({ text: words, start, end })
  }
  return lines.sort((x, y) => x.start - y.start)
}
