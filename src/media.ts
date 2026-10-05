import { aviToMkv, isAvi } from './avi'
import { IS_WEB } from './edition'
import { MP4, QTFF, MATROSKA, WEBM, MPEG_TS, WAVE, MP3, ADTS, FLAC, OGG, BlobSource, Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny'

export type MediaInfo = {
  fileName: string
  fileSize: number
  format: string
  duration: number
  video: null | {
    codec: string
    width: number
    height: number
    rotation: number
    fps: number
    bitrate: number
    canDecode: boolean
  }
  audio: null | {
    codec: string
    sampleRate: number
    channels: number
    canDecode: boolean
  }
}

export type OpenedMedia = {
  info: MediaInfo
  // Only decodable tracks are handed out, so the player never has to check again.
  videoTrack: InputVideoTrack | null
  audioTrack: InputAudioTrack | null
}

// Opens any file Mediabunny can read (MKV, MP4, MOV, WebM, TS and more) straight from disk.
// Nothing is uploaded: BlobSource reads the File in place, a slice at a time.
export async function openMedia(original: File): Promise<OpenedMedia> {
  // AVI is read by our own reader and rewritten in memory first (see avi.ts).
  const avi = !IS_WEB && (await isAvi(original)) // AVI, MKV, WebM and TS open in the app only
  const file = avi ? await aviToMkv(original) : original
  // Only the formats the editor uses. Mediabunny can also read streaming playlists (HLS), which fetch from the
  // internet; that reader is left out on purpose.
  const formats = IS_WEB ? [MP4, QTFF, WAVE, MP3, ADTS, FLAC, OGG] : [MP4, QTFF, MATROSKA, WEBM, MPEG_TS, WAVE, MP3, ADTS, FLAC, OGG]
  const input = new Input({ formats, source: new BlobSource(file) })
  const format = await input.getFormat()
  const duration = await input.computeDuration()
  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()

  let video: MediaInfo['video'] = null
  // A crafted file can claim an enormous picture to fill the memory; anything over 8192 pixels a side is refused.
  if (videoTrack && (videoTrack.displayWidth > 8192 || videoTrack.displayHeight > 8192)) {
    throw new Error(`the video is ${videoTrack.displayWidth} × ${videoTrack.displayHeight}, and videos can be up to 8192 pixels a side`)
  }
  if (videoTrack) {
    const stats = await videoTrack.computePacketStats(100)
    video = {
      codec: videoTrack.codec ?? 'unknown',
      width: videoTrack.displayWidth,
      height: videoTrack.displayHeight,
      rotation: videoTrack.rotation,
      fps: stats.averagePacketRate,
      bitrate: stats.averageBitrate,
      canDecode: await videoTrack.canDecode(),
    }
  }

  const audio: MediaInfo['audio'] = audioTrack
    ? {
        codec: audioTrack.codec ?? 'unknown',
        sampleRate: audioTrack.sampleRate,
        channels: audioTrack.numberOfChannels,
        canDecode: await audioTrack.canDecode(),
      }
    : null

  return {
    info: { fileName: original.name, fileSize: original.size, format: avi ? 'AVI' : format.name, duration, video, audio },
    videoTrack: video?.canDecode ? videoTrack : null,
    audioTrack: audio?.canDecode ? audioTrack : null,
  }
}
