import {
  BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, MkvOutputFormat, Output,
  QUALITY_HIGH, VideoSample, VideoSampleSource, type AudioCodec,
} from 'mediabunny'

// Our own AVI reader (Chrome and Mediabunny cannot open AVI). It reads the AVI's pieces and rewrites them,
// unchanged where possible, into an MKV held in memory, which the rest of the editor then opens as usual.
//   Picture: H.264 is copied as it is. MJPEG (webcams, old cameras) is turned into H.264.
//   Sound: PCM (WAV-style) and MP3 are copied as they are. Anything else opens without sound.
// Old DivX and Xvid AVIs cannot open: Chrome has no decoder for that picture format.
// The whole file is held in memory while it is rewritten, so very large AVIs need plenty of RAM.

const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

export async function isAvi(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  return b.length === 12 && text(b, 0) === 'RIFF' && text(b, 8) === 'AVI '
}

// Reads the file through a 16 MB window, so walking thousands of small pieces stays quick.
class Reader {
  private start = 0
  private buf = new Uint8Array(0)
  private file: File
  constructor(file: File) {
    this.file = file
  }
  async bytes(at: number, len: number): Promise<Uint8Array> {
    if (at < this.start || at + len > this.start + this.buf.length) {
      this.start = at
      this.buf = new Uint8Array(await this.file.slice(at, at + Math.max(len, 16 << 20)).arrayBuffer())
    }
    return this.buf.subarray(at - this.start, at - this.start + len)
  }
}

type Stream = {
  type: string // 'vids' or 'auds'
  scale: number
  rate: number
  strf: Uint8Array
}
type Piece = { data: Uint8Array; slot: number } // slot: the frame number (video) or byte count before it (sound)

const H264 = ['H264', 'h264', 'X264', 'x264', 'AVC1', 'avc1', 'DAVC', 'VSSH']
const MJPEG = ['MJPG', 'mjpg', 'AVRn', 'dmb1', 'JPEG', 'jpeg']

export async function aviToMkv(file: File): Promise<File> {
  const r = new Reader(file)
  const streams: Stream[] = []
  const pieces = new Map<number, Piece[]>()
  const frameCount = new Map<number, number>() // video frames seen, empty ones (repeats) included
  const byteCount = new Map<number, number>()

  // The file is one or more RIFF blocks (big AVIs add 'AVIX' blocks), each with a header list and a 'movi' list.
  let at = 0
  while (at + 12 <= file.size) {
    const h = await r.bytes(at, 12)
    const id = text(h, 0)
    const size = u32(h, 4)
    if (id !== 'RIFF') break
    const end = Math.min(file.size, at + 8 + size)
    let p = at + 12
    while (p + 8 <= end) {
      const c = await r.bytes(p, 12)
      const cid = text(c, 0)
      const csize = u32(c, 4)
      if (cid === 'LIST' && text(c, 8) === 'hdrl') readHeader(await r.bytes(p + 12, csize - 4), streams)
      else if (cid === 'LIST' && text(c, 8) === 'movi') await readMovi(r, p + 12, Math.min(end, p + 8 + csize))
      p += 8 + csize + (csize & 1)
    }
    at = end + (size & 1)
  }

  async function readMovi(r: Reader, from: number, to: number) {
    let p = from
    while (p + 8 <= to) {
      const c = await r.bytes(p, 8)
      const cid = text(c, 0)
      const csize = u32(c, 4)
      if (cid === 'LIST') {
        p += 12 // a 'rec ' group: its pieces follow straight on
        continue
      }
      const m = /^(\d\d)(dc|db|wb)$/.exec(cid)
      if (m) {
        const s = Number(m[1])
        const list = pieces.get(s) ?? []
        pieces.set(s, list)
        if (m[2] === 'wb') {
          const before = byteCount.get(s) ?? 0
          if (csize) list.push({ data: (await r.bytes(p + 8, csize)).slice(), slot: before })
          byteCount.set(s, before + csize)
        } else {
          const n = frameCount.get(s) ?? 0
          if (csize) list.push({ data: (await r.bytes(p + 8, csize)).slice(), slot: n })
          frameCount.set(s, n + 1)
        }
      }
      if (csize > 0x7fffffff) break // broken size: stop rather than run off the end
      p += 8 + csize + (csize & 1)
    }
  }

  const vIndex = streams.findIndex((s) => s.type === 'vids')
  const aIndex = streams.findIndex((s) => s.type === 'auds')
  if (vIndex < 0 && aIndex < 0) throw new Error('this AVI has no picture or sound in it')

  const output = new Output({ format: new MkvOutputFormat(), target: new BufferTarget() })
  const video = vIndex >= 0 ? await prepareVideo(streams[vIndex], pieces.get(vIndex) ?? []) : null
  const audio = aIndex >= 0 ? prepareAudio(streams[aIndex], pieces.get(aIndex) ?? []) : null
  if (!video && !audio) throw new Error('the picture and sound in this AVI are in formats Chrome cannot play')
  if (video) video.attach(output)
  if (audio) output.addAudioTrack(audio.source)
  await output.start()

  // Picture and sound go in together, in time order.
  const vq = video?.items ?? []
  const aq = audio?.packets ?? []
  let vi = 0
  let ai = 0
  while (vi < vq.length || ai < aq.length) {
    if (ai >= aq.length || (vi < vq.length && vq[vi].timestamp <= aq[ai].timestamp)) await video!.add(vi++)
    else {
      await audio!.source.add(aq[ai], ai === 0 ? { decoderConfig: audio!.config } : undefined)
      ai++
    }
  }
  await output.finalize()
  const bytes = (output.target as BufferTarget).buffer!
  return new File([bytes], file.name.replace(/\.avi$/i, '') + '.mkv', { type: 'video/x-matroska', lastModified: file.lastModified })
}

function readHeader(b: Uint8Array, streams: Stream[]) {
  let p = 0
  while (p + 8 <= b.length) {
    const id = text(b, p)
    const size = u32(b, p + 4)
    if (id === 'LIST' && text(b, p + 8) === 'strl') {
      const s: Stream = { type: '', scale: 1, rate: 1, strf: new Uint8Array(0) }
      let q = p + 12
      while (q + 8 <= p + 8 + size) {
        const sid = text(b, q)
        const ssize = u32(b, q + 4)
        if (sid === 'strh') {
          s.type = text(b, q + 8)
          s.scale = u32(b, q + 8 + 20) || 1
          s.rate = u32(b, q + 8 + 24) || 1
        } else if (sid === 'strf') s.strf = b.slice(q + 8, q + 8 + ssize)
        q += 8 + ssize + (ssize & 1)
      }
      streams.push(s)
    }
    p += 8 + size + (size & 1)
  }
}

// ---- Picture ----

type Item = { timestamp: number }
type VideoPlan = { items: Item[]; attach: (o: Output) => void; add: (i: number) => Promise<void> }

async function prepareVideo(s: Stream, list: Piece[]): Promise<VideoPlan | null> {
  const fourcc = text(s.strf, 16)
  const width = u32(s.strf, 4)
  const height = Math.abs(u32(s.strf, 8) | 0)
  const dt = s.scale / s.rate
  if (H264.includes(fourcc)) return prepareH264(list, width, height, dt, s.strf.subarray(40))
  if (MJPEG.includes(fourcc)) return prepareMjpeg(list, width, height, dt)
  return null
}

// Splits H.264 written with start codes (00 00 01) into its units.
function nalUnits(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []
  let start = -1
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      if (start >= 0) out.push(b.subarray(start, i > 0 && b[i - 1] === 0 ? i - 1 : i))
      start = i + 3
      i += 2
    }
  }
  if (start >= 0) out.push(b.subarray(start))
  return out.filter((n) => n.length)
}

async function prepareH264(list: Piece[], width: number, height: number, dt: number, extra: Uint8Array): Promise<VideoPlan | null> {
  const d0 = list[0]?.data
  const annexB = !!d0 && d0[0] === 0 && d0[1] === 0 && (d0[2] === 1 || (d0[2] === 0 && d0[3] === 1))
  let description: Uint8Array
  let packets: { data: Uint8Array; key: boolean; slot: number }[]
  if (annexB) {
    // Rewritten with length prefixes, and the settings (SPS and PPS) gathered into a description.
    let sps: Uint8Array | null = null
    let pps: Uint8Array | null = null
    packets = list.map((pc) => {
      const units = nalUnits(pc.data).filter((n) => (n[0] & 31) !== 9) // drop access unit markers
      let key = false
      for (const n of units) {
        const t = n[0] & 31
        if (t === 7 && !sps) sps = n.slice()
        if (t === 8 && !pps) pps = n.slice()
        if (t === 5) key = true
      }
      const data = new Uint8Array(units.reduce((s, n) => s + 4 + n.length, 0))
      let o = 0
      for (const n of units) {
        data[o] = n.length >>> 24
        data[o + 1] = (n.length >>> 16) & 255
        data[o + 2] = (n.length >>> 8) & 255
        data[o + 3] = n.length & 255
        data.set(n, o + 4)
        o += 4 + n.length
      }
      return { data, key, slot: pc.slot }
    })
    if (!sps || !pps) return null
    const S: Uint8Array = sps
    const P: Uint8Array = pps
    description = new Uint8Array([1, S[1], S[2], S[3], 0xff, 0xe1, S.length >> 8, S.length & 255, ...S, 1, P.length >> 8, P.length & 255, ...P])
  } else {
    // Already length-prefixed, with the description stored in the header.
    if (extra.length < 7 || extra[0] !== 1) return null
    description = extra.slice()
    packets = list.map((pc) => ({ data: pc.data, key: false, slot: pc.slot }))
    // Key frames: any picture holding an IDR unit.
    for (const pk of packets) {
      for (let o = 0; o + 4 < pk.data.length;) {
        const len = u32be(pk.data, o)
        if ((pk.data[o + 4] & 31) === 5) pk.key = true
        o += 4 + len
      }
    }
  }
  const first = packets.findIndex((pk) => pk.key)
  if (first < 0) return null
  packets = packets.slice(first)
  const codec = `avc1.${[description[1], description[2], description[3]].map((x) => x.toString(16).padStart(2, '0')).join('')}`
  const config: VideoDecoderConfig = { codec, codedWidth: width, codedHeight: height, description }
  if (!(await VideoDecoder.isConfigSupported(config)).supported) return null

  // AVI keeps pictures in decoding order and has no showing times. With B-frames the two orders differ,
  // so the decoder is run once to learn the showing order; the pictures themselves are not changed.
  const order = await showingOrder(config, packets)
  const slots = packets.map((pk) => pk.slot).sort((a, b) => a - b)
  const pts = new Array<number>(packets.length)
  order.forEach((decodeIndex, k) => { pts[decodeIndex] = slots[k] * dt })
  for (let i = 0; i < pts.length; i++) if (pts[i] === undefined) pts[i] = packets[i].slot * dt
  const sortedPts = pts.slice().sort((a, b) => a - b)
  const nextPts = new Map<number, number>()
  sortedPts.forEach((t, k) => nextPts.set(t, sortedPts[k + 1] ?? t + dt))

  const source = new EncodedVideoPacketSource('avc')
  const items = packets.map((_, i) => ({ timestamp: pts[i] }))
  // Interleaving with sound goes by decoding order, so the time used for it never runs backwards.
  const mono = items.map((_, i) => ({ timestamp: packets[i].slot * dt }))
  return {
    items: mono,
    attach: (o) => o.addVideoTrack(source, { frameRate: 1 / dt }),
    add: (i) =>
      source.add(
        new EncodedPacket(packets[i].data, packets[i].key ? 'key' : 'delta', pts[i], nextPts.get(pts[i])! - pts[i], i),
        i === 0 ? { decoderConfig: config } : undefined,
      ),
  }
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

// Feeds every picture to the decoder (each one thrown away at once) and notes the order they come out in.
async function showingOrder(config: VideoDecoderConfig, packets: { data: Uint8Array; key: boolean }[]): Promise<number[]> {
  const order: number[] = []
  let failed = false
  const dec = new VideoDecoder({
    output: (f) => {
      order.push(f.timestamp)
      f.close()
    },
    error: () => { failed = true },
  })
  try {
    dec.configure(config)
    for (let i = 0; i < packets.length && !failed; i++) {
      dec.decode(new EncodedVideoChunk({ type: packets[i].key ? 'key' : 'delta', timestamp: i, data: packets[i].data }))
      while (dec.decodeQueueSize > 20 && !failed) await new Promise((r) => setTimeout(r, 1))
    }
    if (!failed) await dec.flush()
  } catch {
    failed = true
  } finally {
    if (dec.state !== 'closed') dec.close()
  }
  // If decoding failed part way, fall back to decoding order for the rest.
  if (failed || order.length !== packets.length) return packets.map((_, i) => i)
  return order
}

// The Huffman tables most JPEGs carry. MJPEG cameras often leave them out to save space; browsers need them.
const STANDARD_DHT = Uint8Array.from(
  ('ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa'
    .match(/../g) ?? []).map((h) => parseInt(h, 16)),
)

function withTables(jpeg: Uint8Array): Uint8Array {
  // Walk the markers up to the start of the picture data; add the standard tables if there are none.
  let p = 2
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const m = jpeg[p + 1]
    if (m === 0xc4) return jpeg
    if (m === 0xda) break
    p += 2 + ((jpeg[p + 2] << 8) | jpeg[p + 3])
  }
  const out = new Uint8Array(jpeg.length + STANDARD_DHT.length)
  out.set(jpeg.subarray(0, p))
  out.set(STANDARD_DHT, p)
  out.set(jpeg.subarray(p), p + STANDARD_DHT.length)
  return out
}

async function prepareMjpeg(list: Piece[], width: number, height: number, dt: number): Promise<VideoPlan | null> {
  if (!list.length) return null
  // Each picture is a JPEG: shown by the browser, then turned into H.264 (WebCodecs cannot play MJPEG).
  const source = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH, sizeChangeBehavior: 'contain' })
  const items = list.map((pc) => ({ timestamp: pc.slot * dt }))
  return {
    items,
    attach: (o) => o.addVideoTrack(source, { frameRate: 1 / dt }),
    add: async (i) => {
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(new Blob([withTables(list[i].data) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
      } catch {
        return // a broken picture: the one before stays on screen
      }
      const next = list[i + 1]?.slot ?? list[i].slot + 1
      const frame = new VideoFrame(bitmap, { timestamp: Math.round(list[i].slot * dt * 1e6) })
      bitmap.close()
      const sample = new VideoSample(frame, { timestamp: list[i].slot * dt, duration: (next - list[i].slot) * dt })
      await source.add(sample)
      sample.close()
      void width
      void height
    },
  }
}

// ---- Sound ----

type AudioPlan = { source: EncodedAudioPacketSource; config: AudioDecoderConfig; packets: EncodedPacket[] }

function prepareAudio(s: Stream, list: Piece[]): AudioPlan | null {
  const f = s.strf
  let tag = u16(f, 0)
  const channels = u16(f, 2)
  const rate = u32(f, 4)
  const blockAlign = u16(f, 12) || 1
  const bits = u16(f, 14)
  if (tag === 0xfffe && f.length >= 18 + 22) tag = u16(f, 18 + 6) // 'extensible': the real format is inside
  if (!channels || !rate || !list.length) return null

  if (tag === 1 || tag === 3) {
    const codec = (tag === 3 ? { 32: 'pcm-f32', 64: 'pcm-f64' } : { 8: 'pcm-u8', 16: 'pcm-s16', 24: 'pcm-s24', 32: 'pcm-s32' } as Record<number, string>)[bits] as AudioCodec | undefined
    if (!codec) return null
    const source = new EncodedAudioPacketSource(codec)
    const packets: EncodedPacket[] = []
    list.forEach((pc, i) => {
      const usable = pc.data.length - (pc.data.length % blockAlign)
      if (!usable) return
      packets.push(new EncodedPacket(pc.data.subarray(0, usable), 'key', pc.slot / blockAlign / rate, usable / blockAlign / rate, i))
    })
    return { source, config: { codec, sampleRate: rate, numberOfChannels: channels }, packets }
  }

  if (tag === 0x55) {
    // MP3: AVI pieces need not line up with MP3 frames, so the sound is joined and cut again frame by frame.
    const all = new Uint8Array(list.reduce((n, pc) => n + pc.data.length, 0))
    let o = 0
    for (const pc of list) {
      all.set(pc.data, o)
      o += pc.data.length
    }
    const packets: EncodedPacket[] = []
    let samples = 0
    let frameRate = 0
    for (let p = 0; p + 4 <= all.length;) {
      const fr = mp3Frame(all, p)
      if (!fr) {
        p++
        continue
      }
      if (!frameRate) frameRate = fr.rate
      packets.push(new EncodedPacket(all.slice(p, p + fr.length), 'key', samples / frameRate, fr.samples / frameRate, packets.length))
      samples += fr.samples
      p += fr.length
    }
    if (!packets.length) return null
    return { source: new EncodedAudioPacketSource('mp3'), config: { codec: 'mp3', sampleRate: frameRate, numberOfChannels: channels }, packets }
  }
  return null
}

const MP3_RATES = [44100, 48000, 32000]
const MP3_KBPS_1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MP3_KBPS_2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

// One MP3 (MPEG layer III) frame header: how long the frame is and how many samples it holds.
function mp3Frame(b: Uint8Array, p: number): { length: number; samples: number; rate: number } | null {
  if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null
  const version = (b[p + 1] >> 3) & 3 // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (b[p + 1] >> 1) & 3 // 1: layer III
  const bitrateIndex = b[p + 2] >> 4
  const rateIndex = (b[p + 2] >> 2) & 3
  const padding = (b[p + 2] >> 1) & 1
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const mpeg1 = version === 3
  const rate = MP3_RATES[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4)
  const kbps = (mpeg1 ? MP3_KBPS_1 : MP3_KBPS_2)[bitrateIndex]
  const length = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / rate) + padding
  return length > 4 ? { length, samples: mpeg1 ? 1152 : 576, rate } : null
}
