import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny'

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
  const file = original
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const format = await input.getFormat()
  const duration = await input.computeDuration()
  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()

  let video: MediaInfo['video'] = null
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
    info: { fileName: original.name, fileSize: original.size, format: format.name, duration, video, audio },
    videoTrack: video?.canDecode ? videoTrack : null,
    audioTrack: audio?.canDecode ? audioTrack : null,
  }
}
