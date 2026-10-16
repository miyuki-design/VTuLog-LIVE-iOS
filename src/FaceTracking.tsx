import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

type FrameEvent = { camera: 'front' | 'rear'; jpeg: string }
const MultiCam = registerPlugin<{
  start(): Promise<void>
  stop(): Promise<void>
  addListener(event: 'frame', cb: (data: FrameEvent) => void): Promise<PluginListenerHandle>
}>('MultiCam')

/** Diagnostic only: do not analyze, draw, record or upload front-camera images. */
export function FaceTracking({ rearStreamRef, onBeginNativeCameras, onNativeRearFrame,
  onEndNativeCameras }: {
  pixiAppRef: MutableRefObject<any>
  rearStreamRef: MutableRefObject<MediaStream | null>
  onRearCameraInterrupted: () => Promise<void>
  onBeginNativeCameras: () => Promise<void>
  onNativeRearFrame: (jpeg: string) => void
  onEndNativeCameras: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [message, setMessage] = useState('前後カメラは未起動です。')
  const [counts, setCounts] = useState({ front: 0, rear: 0 })
  const countsRef = useRef({ front: 0, rear: 0 })
  const listenerRef = useRef<PluginListenerHandle | null>(null)
  const nativeRef = useRef(false)
  const disposedRef = useRef(false)
  const runningRef = useRef(false)
  const generationRef = useRef(0)
  const busyRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setCounts({ ...countsRef.current }), 500)
    return () => window.clearInterval(timer)
  }, [])

  const stopCameras = async (restore = true) => {
    const generation = ++generationRef.current
    runningRef.current = false
    busyRef.current = true
    if (!disposedRef.current) { setBusy(true); setMessage('前後カメラを終了しています…') }
    const listener = listenerRef.current
    listenerRef.current = null
    try { await listener?.remove() } catch (e) { console.warn('MultiCam listener cleanup', e) }
    // Even a partially successful start may have started a capture session.
    if (nativeRef.current) {
      try { await MultiCam.stop() } catch (e) { console.warn('MultiCam stop', e) }
      nativeRef.current = false
      if (restore) {
        try {
          await onEndNativeCameras()
          if (!disposedRef.current && generation === generationRef.current) setMessage('✅ 前後カメラ停止。背面カメラを復旧しました。')
        } catch (error) {
          if (!disposedRef.current && generation === generationRef.current)
            setMessage(`❌ 背面カメラ復旧失敗：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (!disposedRef.current && generation === generationRef.current) {
      setCameraOn(false)
      setBusy(false)
      busyRef.current = false
    }
  }

  useEffect(() => {
    disposedRef.current = false
    return () => {
    disposedRef.current = true
    ++generationRef.current
    runningRef.current = false
    const listener = listenerRef.current
    listenerRef.current = null
    void listener?.remove()
    if (nativeRef.current) {
      nativeRef.current = false
      void MultiCam.stop().catch(console.warn).finally(() => { void onEndNativeCameras() })
    }
    }
  }, [])

  const diagnoseMediaPipe = async () => {
    if (busyRef.current || runningRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('MediaPipe WASMを読み込み中…')
    let model: FaceLandmarker | null = null
    try {
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm')
      model = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
      })
      if (!disposedRef.current) setMessage('✅ MediaPipe初期化成功。カメラの切替えなし。')
    } catch (error) {
      if (!disposedRef.current) setMessage(`❌ MediaPipe診断失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      model?.close()
      busyRef.current = false
      if (!disposedRef.current) setBusy(false)
    }
  }

  const diagnoseCameras = async () => {
    if (busyRef.current || runningRef.current) return
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      setMessage('⚠️ 前後カメラ同時起動診断はiOSネイティブアプリ専用です。')
      return
    }
    const rear = rearStreamRef.current?.getVideoTracks()[0]
    if (!rear || rear.readyState !== 'live') {
      setMessage('⚠️ 背面カメラのREADY表示を待ってから試してください。')
      return
    }
    busyRef.current = true
    setBusy(true)
    setMessage('① カメラのイベント受信を準備中…')
    const generation = ++generationRef.current
    countsRef.current = { front: 0, rear: 0 }
    setCounts({ ...countsRef.current })
    try {
      listenerRef.current = await MultiCam.addListener('frame', ({ camera, jpeg }) => {
        if (!runningRef.current || disposedRef.current || generation !== generationRef.current) return
        if (camera === 'front') {
          // Count front frames only: no image decoding and no face recognition.
          countsRef.current.front++
        } else if (camera === 'rear') {
          countsRef.current.rear++
          onNativeRearFrame(jpeg)
        }
      })
      if (disposedRef.current || generation !== generationRef.current) return
      setMessage('② WebViewの背面カメラを解放中…')
      nativeRef.current = true // Mark before switching so partial failures restore the rear camera.
      await onBeginNativeCameras()
      if (disposedRef.current || generation !== generationRef.current) return
      setMessage('③ ネイティブ前後カメラを起動中…')
      runningRef.current = true
      await MultiCam.start()
      if (disposedRef.current || generation !== generationRef.current) return
      setCameraOn(true)
      setMessage('✅ 前後カメラ起動成功。前面・背面の受信数が増えるか確認してね。')
    } catch (error) {
      if (!disposedRef.current && generation === generationRef.current)
        setMessage(`❌ 同時起動失敗：${error instanceof Error ? error.message : String(error)}（カメラを復旧します）`)
      await stopCameras()
    } finally {
      busyRef.current = false
      if (!disposedRef.current) setBusy(false)
    }
  }

  const buttonStyle = { padding: '8px 11px', borderRadius: 12, background: '#35214c', color: '#fff', fontSize: 12, border: '1px solid #aa89d6' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" style={buttonStyle} disabled={busy || cameraOn}
          onClick={() => { void diagnoseMediaPipe() }}>MediaPipeだけ診断する</button>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={() => { void (cameraOn ? stopCameras() : diagnoseCameras()) }}>
          {cameraOn ? '前後カメラを停止・復旧' : '前後カメラ同時起動テスト'}
        </button>
      </div>
      <span role="status" style={{ fontSize: 10, color: '#d8c8f2', maxWidth: 310, overflowWrap: 'anywhere' }}>{message}</span>
      {cameraOn && <span style={{ fontSize: 11, color: '#a4f0d3' }}>受信フレーム数：前面 {counts.front} / 背面 {counts.rear}（顔認識・表情反映なし）</span>}
    </div>
  )
}
