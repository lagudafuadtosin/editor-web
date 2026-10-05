// AI models by name. In the Windows app the app itself downloads them from github.com/lagudafuadtosin/editor-models,
// checks each file against its fingerprint and keeps it on this PC (desktop/models.cjs). The page then loads the
// files from the PC. Run from source in a browser (npm run dev) there is no app, so the files come from Hugging Face.
type Bridge = { ensure: (name: string, files: string[], onProgress: (loaded: number, total: number) => void) => Promise<string> }
const bridge = (globalThis as { editorModels?: Bridge }).editorModels

export const CAPTION_MODELS = {
  fast: { name: 'captions-fast', folder: 'onnx-community/whisper-base_timestamped' },
  accurate: { name: 'captions-accurate', folder: 'onnx-community/whisper-small_timestamped' },
} as const

const COMMON = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt', 'normalizer.json']

export type Device = { device: 'webgpu' | 'wasm'; f16: boolean }

// The graphics card if there is one (faster), otherwise the processor.
export async function device(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
  return { device: adapter ? 'webgpu' : 'wasm', f16: !!adapter?.features.has('shader-f16') }
}

// Smaller downloads where the graphics card allows it, full precision where it does not.
export function captionDtype(model: keyof typeof CAPTION_MODELS, d: Device) {
  return d.device === 'webgpu'
    ? { encoder_model: model === 'accurate' && d.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'q8', decoder_model_merged: 'q8' }
}

const SUFFIX: Record<string, string> = { fp32: '', fp16: '_fp16', q4: '_q4', q8: '_quantized' }

// Makes sure the caption model's files for this computer are here. False when running from source in a browser.
export async function ensureCaptionModel(model: keyof typeof CAPTION_MODELS, d: Device, onProgress: (loaded: number, total: number) => void): Promise<boolean> {
  if (!bridge) return false
  const dtype = captionDtype(model, d)
  const files = [...COMMON, ...Object.entries(dtype).map(([part, t]) => `onnx/${part}${SUFFIX[t]}.onnx`)]
  await bridge.ensure(CAPTION_MODELS[model].name, files, onProgress)
  return true
}

