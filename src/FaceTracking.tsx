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

type PixiRef = MutableRefObject<any>
type Scores = { mouth: number; smile: number; leftEye: number; rightEye: number }
const DEFAULT: Scores = { mouth: 0, smile: 0, leftEye: 1, rightEye: 1 }

function score(categories: { categoryName: string; score: number }[], key: string) {
  return categories.find(item => item.categoryName === key)?.score ?? 0
}


// Debug information is local to the UI. No face frames are displayed, uploaded, or saved.
type TrackingDebug = {
  frontReceived: number
  rearReceived: number
  frontDecoded: number
  analyzed: number
  detected: number
  lastFaceAt: number
  jawOpen: number
  jawMax: number
  smileRaw: number
  eyeBlinkL: number
  mouthFunnel: number
  blendshapeCount: number
  frontFrameSize: string
  blendshapeTop: string
  framesChanged: number
  lastFrameSignature: string
  mouthTarget: number
  live2D: string
  parameters: string
  modelUpdates: number
  writes: number
  error: string
}
const emptyDebug = (): TrackingDebug => ({
  frontReceived: 0, rearReceived: 0, frontDecoded: 0,
  analyzed: 0, detected: 0, lastFaceAt: 0, jawOpen: 0, jawMax: 0, smileRaw: 0,
  eyeBlinkL: 0, mouthFunnel: 0, blendshapeCount: 0, frontFrameSize: '未受信',
  blendshapeTop: '-', framesChanged: 0, lastFrameSignature: '', mouthTarget: 0,
  live2D: '未確認', parameters: '未確認', modelUpdates: 0, writes: 0, error: '',
})

/** Front camera frames are analyzed privately; selfie images are not shown or recorded. */
export function FaceTracking({ pixiAppRef, rearStreamRef, onRearCameraInterrupted,
  onBeginNativeCameras, onNativeRearFrame, onEndNativeCameras }: {
  pixiAppRef: PixiRef
  rearStreamRef: MutableRefObject<MediaStream | null>
  onRearCameraInterrupted: () => Promise<void>
  onBeginNativeCameras: () => Promise<void>
  onNativeRearFrame: (jpeg: string) => void
  onEndNativeCameras: () => Promise<void>
}) {
  const [state, setState] = useState<'off' | 'starting' | 'on'>('off')
  const [message, setMessage] = useState('')
  // iPhone 17 native JPEG orientation: counterclockwise is upright.
  const frontRotationRef = useRef<'clockwise' | 'counterclockwise'>('counterclockwise')
  const scoresRef = useRef<Scores>({ ...DEFAULT })
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastAnalyzedRef = useRef(0)
  const generationRef = useRef(0)
  const runningRef = useRef(false)
  const recoveringRef = useRef(false)
  const nativeRef = useRef(false)
  const listenerRef = useRef<PluginListenerHandle | null>(null)
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frontDecodingRef = useRef(false)
  const frontFrameReadyRef = useRef(false)
  const debugRef = useRef<TrackingDebug>(emptyDebug())

  const stop = () => {
    generationRef.current++
    runningRef.current = false
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
      videoRef.current = null
    }
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    scoresRef.current = { ...DEFAULT }
    frontFrameReadyRef.current = false
    frontCanvasRef.current = null
    frontDecodingRef.current = false
    setState('off')
    // Remove the native event listener even when startup failed halfway.
    void listenerRef.current?.remove()
    listenerRef.current = null
    if (nativeRef.current) {
      nativeRef.current = false
      void MultiCam.stop().finally(() => { void onEndNativeCameras() })
    }
  }

  // Restore the rear viewfinder after the front camera has displaced it.
  const restoreRear = async () => {
    if (recoveringRef.current) return
    recoveringRef.current = true
    stop() // Release front camera BEFORE trying to reopen rear camera.
    setMessage('背面カメラを復旧中…')
    try {
      await onRearCameraInterrupted()
      setMessage('前後カメラの同時利用に失敗しました。背面カメラを復旧しました。')
    } catch (error) {
      setMessage(`背面カメラの復旧に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      recoveringRef.current = false
    }
  }

  // FaceTrack prototype uses beforeModelUpdate, not a Pixi ticker callback.
  // The latter may run BEFORE the model's motions update and get overwritten.
  useEffect(() => {
    if (state !== 'on') return
    const app = pixiAppRef.current
    const model: any = app?.stage?.children?.find((child: any) => child?.internalModel?.coreModel)
    const internal: any = model?.internalModel
    const core: any = internal?.coreModel
    if (!internal?.on || !core) {
      debugRef.current.live2D = 'モデルが見つかりません'
      return
    }
    debugRef.current.live2D = 'モデル接続OK'

    // Find the real Cubism parameter indices, as in VTuLog-FaceTrack.
    const raw: any = core._model?.parameters
    const count: number = typeof core.getParameterCount === 'function'
      ? core.getParameterCount() : (raw?.count ?? 0)
    const params = new Map<string, { index: number; min: number; max: number }>()
    for (let i = 0; i < count; i++) {
      const rawId = raw?.ids?.[i] ?? (typeof core.getParameterId === 'function' ? core.getParameterId(i) : null)
      if (rawId == null) continue
      const id = typeof rawId?.getString === 'function' ? rawId.getString() : String(rawId)
      params.set(id, {
        index: i,
        min: raw?.minimumValues?.[i] ?? -1,
        max: raw?.maximumValues?.[i] ?? 1,
      })
    }
    const keys = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen']
    debugRef.current.parameters = keys.map((k, i) =>
      `${['口開','口形','左目','右目'][i]}:${params.has(k) ? '有' : '無'}`
    ).join(' / ')
    const smoothed = new Map<string, number>()
    const drive = (id: string, target: number, alpha: number) => {
      const param = params.get(id)
      if (!param) return
      const previous = smoothed.get(id) ?? (raw?.values?.[param.index] ?? target)
      const value = Math.max(param.min, Math.min(param.max, previous + (target - previous) * alpha))
      smoothed.set(id, value)
      if (typeof core.setParameterValueByIndex === 'function') {
        core.setParameterValueByIndex(param.index, value)
      } else if (raw?.values) {
        raw.values[param.index] = value
      } else {
        debugRef.current.error = 'Live2Dパラメータの書き込みAPIがありません'
        return
      }
      debugRef.current.writes++
    }
    const apply = () => {
      if (!runningRef.current) return
      debugRef.current.modelUpdates++
      const s = scoresRef.current
      try {
        drive('ParamMouthOpenY', s.mouth, 0.90)
        drive('ParamMouthForm', s.smile, 0.36)
        drive('ParamEyeLOpen', s.leftEye, 0.55)
        drive('ParamEyeROpen', s.rightEye, 0.55)
      } catch (error) {
        debugRef.current.error = error instanceof Error ? error.message : String(error)
      }
    }
    internal.on('beforeModelUpdate', apply)
    return () => { try { internal.off?.('beforeModelUpdate', apply) } catch { /* destroyed */ } }
  }, [pixiAppRef, state])

  useEffect(() => () => {
    generationRef.current++
    runningRef.current = false
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    landmarkerRef.current?.close()
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null }
    void listenerRef.current?.remove()
    if (nativeRef.current) {
      nativeRef.current = false
      void MultiCam.stop().finally(() => { void onEndNativeCameras() })
    }
  }, [])

  // DIAGNOSTIC ONLY: This intentionally never opens front camera, stops the rear
  // camera, or starts MultiCam. If the display stays visible, isolate next step.
  const start = async () => {
    if (state === 'starting') return
    setState('starting')
    setMessage('診断 1/2：MediaPipe WASM を読み込み中…')
    const generation = ++generationRef.current
    let landmarker: FaceLandmarker | null = null
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
      )
      if (generation !== generationRef.current) return
      setMessage('診断 2/2：顔認識モデルを読み込み中…')
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      })
      if (generation !== generationRef.current) return
      setMessage('✅ MediaPipe初期化成功。前後カメラは切替えていません。画面が正常か確認してください。')
    } catch (error) {
      if (generation !== generationRef.current) return
      setMessage(`❌ MediaPipe初期化失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      landmarker?.close()
      if (generation === generationRef.current) setState('off')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <button type="button" disabled={state === 'starting'}
        onClick={start}
        style={{ padding: '7px 10px', borderRadius: 12, background: '#35214c', color: '#fff', fontSize: 12, border: '1px solid #aa89d6' }}>
        {state === 'starting' ? '診断中…' : 'MediaPipeだけ診断する'}
      </button>
      {message && <span role="status" style={{ fontSize: 10, color: '#d8c8f2', maxWidth: 280 }}>{message}</span>}
    </div>
  )
}