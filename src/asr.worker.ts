// Web version: captions are in the free app. Only the message types, so the shared code builds.
import type { Device } from './models'

export type AsrRequest = { id: number; model: 'fast' | 'accurate'; device: Device; language: string | null; audio: Float32Array }
export type AsrMessage =
  | { id: number; type: 'loading'; loaded: number; total: number }
  | { id: number; type: 'working' }
  | { id: number; type: 'done'; words: { text: string; start: number; end: number }[] }
  | { id: number; type: 'error'; message: string }
