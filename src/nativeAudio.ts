import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeAudioRoute = { input: string[]; output: string[]; sampleRate: number }
interface NativeAudioAPI {
  configure(options: { mode: 'record' | 'playback'; profile?: 'voice' | 'studio' }): Promise<NativeAudioRoute>
  getRoute(): Promise<NativeAudioRoute>
  startPCM(): Promise<{ sampleRate: number }>
  stopPCM(): Promise<void>
  addListener(eventName: 'pcm', listener: (event: { samples: string }) => void): Promise<PluginListenerHandle>
}

export const NativeAudio = registerPlugin<NativeAudioAPI>('NativeAudio')
export const isNativeIPhone = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export async function prepareIPhoneRecording(profile: 'voice' | 'studio' = 'voice'): Promise<void> {
  if (!isNativeIPhone) return
  const route = await NativeAudio.configure({ mode: 'record', profile })
  console.info('iPhone recording route:', route)
}

export async function prepareIPhonePlayback(): Promise<void> {
  if (!isNativeIPhone) return
  const route = await NativeAudio.configure({ mode: 'playback' })
  console.info('iPhone playback route:', route)
}

// Float32, mono, little-endian PCM from the native AVAudioEngine input tap.
export function decodeNativePCM(base64: string): Float32Array {
  const binary = atob(base64)
  if (binary.length % 4 !== 0) throw new Error('録音PCMのサイズが正しくありません')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}
