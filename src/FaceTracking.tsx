import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { FaceMotionController, REST, type TrackingScores } from './faceMotion'

type FrameEvent = { camera: 'front' | 'rear'; jpeg: string }
const MultiCam = registerPlugin<{
  start(): Promise<void>
  stop(): Promise<void>
  addListener(event: 'frame', cb: (data: FrameEvent) => void): Promise<PluginListenerHandle>
}>('MultiCam')

type PixiRef = MutableRefObject<any>
type Scores = TrackingScores
const DEFAULT: Scores = REST

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
  onBeginNativeCameras, onNativeRearFrame, onNativeCamerasStopping, onEndNativeCameras, rearCameraReady }: {
  pixiAppRef: PixiRef
  rearCameraReady: boolean
  rearStreamRef: MutableRefObject<MediaStream | null>
  onRearCameraInterrupted: () => Promise<void>
  onBeginNativeCameras: () => Promise<void>
  onNativeRearFrame: (jpeg: string) => void
  onNativeCamerasStopping: () => void
  onEndNativeCameras: () => Promise<void>
}) {
  const [state, setState] = useState<'off' | 'starting' | 'on'>('off')
  const autoStartRequestedRef = useRef(false)
  const [message, setMessage] = useState('')
  // iPhone 17 native JPEG orientation: counterclockwise is upright.
  const frontRotationRef = useRef<'clockwise' | 'counterclockwise'>('counterclockwise')
  const scoresRef = useRef<Scores>({ ...DEFAULT })
  const motionRef = useRef(new FaceMotionController())
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
    motionRef.current.reset()
    frontFrameReadyRef.current = false
    frontCanvasRef.current = null
    frontDecodingRef.current = false
    setState('off')
    // Remove the native event listener even when startup failed halfway.
    void listenerRef.current?.remove()
    listenerRef.current = null
    if (nativeRef.current) {
      nativeRef.current = false
      onNativeCamerasStopping()
      void MultiCam.stop().catch(error => console.warn('MultiCam stop failed', error)).finally(() => { void onEndNativeCameras() })
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
    const keys = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen',
      'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']
    debugRef.current.parameters = keys.map((k, i) =>
      `${['口開','口形','左目','右目','頭X','頭Y','頭Z','体X','体Y','体Z'][i]}:${params.has(k) ? '有' : '無'}`
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
        // Head responds promptly; torso follows a little more slowly.
        drive('ParamAngleX', s.headX, 0.20)
        drive('ParamAngleY', s.headY, 0.20)
        drive('ParamAngleZ', s.headZ, 0.20)
        drive('ParamBodyAngleX', s.bodyX, 0.10)
        drive('ParamBodyAngleY', s.bodyY, 0.10)
        drive('ParamBodyAngleZ', s.bodyZ, 0.10)
      } catch (error) {
        debugRef.current.error = error instanceof Error ? error.message : String(error)
      }
    }
    internal.on('beforeModelUpdate', apply)
    return () => { try { internal.off?.('beforeModelUpdate', apply) } catch { /* destroyed */ } }
  }, [pixiAppRef, state])

  useEffect(() => () => {
    autoStartRequestedRef.current = false
    generationRef.current++
    runningRef.current = false
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    landmarkerRef.current?.close()
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null }
    void listenerRef.current?.remove()
    if (nativeRef.current) {
      nativeRef.current = false
      onNativeCamerasStopping()
      void MultiCam.stop().catch(error => console.warn('MultiCam stop failed', error)).finally(() => { void onEndNativeCameras() })
    }
  }, [])

  const start = async () => {
    debugRef.current = emptyDebug()
    setState('starting')
    setMessage('① MediaPipe WASMを読み込み中…')
    const generation = ++generationRef.current
    let attemptedFrontCamera = false
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
      )
      if (generation !== generationRef.current) return
      setMessage('② 顔認識モデルを読み込み中…')
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      })
      if (generation !== generationRef.current) { landmarker.close(); return }
      landmarkerRef.current = landmarker

      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
        // iOS WKWebView cannot reliably own the rear camera while opening the front.
        // Hand both cameras to ONE native AVCaptureMultiCamSession instead.
        const canvas = document.createElement('canvas')
        canvas.width = 240
        canvas.height = 320
        frontCanvasRef.current = canvas
        const ctx = canvas.getContext('2d')!
        frontFrameReadyRef.current = false
        // Detect directly from the canvas. Do NOT await video.play() here:
        // a canvas-backed MediaStream may never play until the first frame,
        // but native cameras cannot start until after that await (deadlock).
        setMessage('③ ネイティブカメラを接続中…')
        const handle = await MultiCam.addListener('frame', ({ camera, jpeg }) => {
          if (generation !== generationRef.current) return
          if (camera === 'rear') {
            debugRef.current.rearReceived++
            onNativeRearFrame(jpeg)
            return
          }
          debugRef.current.frontReceived++
          if (frontDecodingRef.current) return
          frontDecodingRef.current = true
          const img = new Image()
          img.onload = () => {
            if (generation === generationRef.current) {
              // Native front JPEG is landscape (e.g. 320x180). Rotate it to portrait
              // BEFORE analysis; keep aspect ratio (no 320x180 -> 240x320 stretching).
              ctx.save()
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              ctx.fillStyle = '#000'
              ctx.fillRect(0, 0, canvas.width, canvas.height)
              const sourceW = img.naturalWidth
              const sourceH = img.naturalHeight
              // After rotation the source dimensions are sourceH x sourceW.
              const scale = Math.min(canvas.width / sourceH, canvas.height / sourceW)
              const w = sourceW * scale
              const h = sourceH * scale
              if (frontRotationRef.current === 'clockwise') {
                ctx.translate(canvas.width / 2, canvas.height / 2)
                ctx.rotate(Math.PI / 2)
              } else {
                ctx.translate(canvas.width / 2, canvas.height / 2)
                ctx.rotate(-Math.PI / 2)
              }
              ctx.drawImage(img, -w / 2, -h / 2, w, h)
              ctx.restore()
              debugRef.current.frontFrameSize = `${img.naturalWidth}×${img.naturalHeight}`
              frontFrameReadyRef.current = true
              debugRef.current.frontDecoded++
            }
            frontDecodingRef.current = false
          }
          img.onerror = () => { frontDecodingRef.current = false }
          img.src = `data:image/jpeg;base64,${jpeg}`
        })
        listenerRef.current = handle
        if (generation !== generationRef.current) return
        setMessage('④ 背面カメラを切り替え中…')
        await onBeginNativeCameras()
        nativeRef.current = true
        setMessage('⑤ 前後カメラを起動中…')
        try { await MultiCam.start() } catch (error) {
          stop()
          throw error
        }
        if (generation !== generationRef.current) return
        runningRef.current = true
        setState('on')
        setMessage('前後カメラ起動済み。顔の映像を待っています…')
        const loop = () => {
          if (generation !== generationRef.current || !runningRef.current) return
          const now = performance.now()
          if (frontFrameReadyRef.current && now - lastAnalyzedRef.current >= 65) {
            lastAnalyzedRef.current = now
            try {
              debugRef.current.analyzed++
              const result = landmarker.detectForVideo(canvas, now)
              const categories = result.faceBlendshapes?.[0]?.categories
              if (categories) {
                debugRef.current.detected++
                debugRef.current.lastFaceAt = Date.now()
                debugRef.current.jawOpen = score(categories, 'jawOpen')
                debugRef.current.jawMax = Math.max(debugRef.current.jawMax, debugRef.current.jawOpen)
                debugRef.current.smileRaw = (score(categories, 'mouthSmileLeft') + score(categories, 'mouthSmileRight')) / 2
                debugRef.current.eyeBlinkL = score(categories, 'eyeBlinkLeft')
                debugRef.current.mouthFunnel = score(categories, 'mouthFunnel')
                debugRef.current.blendshapeCount = categories.length
                setMessage(prev => prev.startsWith('表情追跡中') ? prev : '表情追跡中（顔の映像は表示・保存しません）')
                const motion = motionRef.current.update(result, now)
                if (motion) scoresRef.current = motion
                debugRef.current.mouthTarget = scoresRef.current.mouth
              } else {
                scoresRef.current = motionRef.current.whenMissing(now) ?? scoresRef.current
              }
            } catch (error) {
              debugRef.current.error = error instanceof Error ? error.message : String(error)
              console.warn('Native tracking frame:', error)
            }
          }
          frameRef.current = requestAnimationFrame(loop)
        }
        frameRef.current = requestAnimationFrame(loop)
        return
      }

      const rearTrack = rearStreamRef.current?.getVideoTracks()[0]
      if (!rearTrack || rearTrack.readyState !== 'live') throw new Error('背面カメラの起動後に試してください')
      attemptedFrontCamera = true
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'user' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: false,
      })
      if (generation !== generationRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (rearTrack.readyState !== 'live' || rearTrack.muted) {
        await restoreRear()
        return
      }

      const video = document.createElement('video')
      video.muted = true
      video.autoplay = true
      video.playsInline = true
      video.srcObject = stream
      videoRef.current = video
      await video.play()
      if (generation !== generationRef.current) return
      if (rearTrack.readyState !== 'live' || rearTrack.muted) {
        await restoreRear()
        return
      }
      runningRef.current = true
      setState('on')
      setMessage('表情追跡中（顔の映像は表示・保存しません）')

      const loop = () => {
        if (!runningRef.current || generation !== generationRef.current) return
        const now = performance.now()
        if (rearTrack.readyState !== 'live' || rearTrack.muted) {
          void restoreRear()
          return
        }
        if (video.readyState >= 2 && now - lastAnalyzedRef.current >= 80) {
          lastAnalyzedRef.current = now
          try {
            const result = landmarker.detectForVideo(video, now)
            const categories = result.faceBlendshapes?.[0]?.categories
            if (categories) {
              const motion = motionRef.current.update(result, now)
              if (motion) scoresRef.current = motion
            } else {
              scoresRef.current = motionRef.current.whenMissing(now) ?? scoresRef.current
            }
          } catch (error) { console.warn('Face tracking frame:', error) }
        }
        frameRef.current = requestAnimationFrame(loop)
      }
      frameRef.current = requestAnimationFrame(loop)
    } catch (error) {
      if (generation !== generationRef.current) return
      if (attemptedFrontCamera) {
        // Even getUserMedia rejection may have interrupted the rear camera.
        await restoreRear()
      } else {
        stop()
      }
      setMessage(`表情追跡を開始できません: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Start automatically when the rear camera is ready. Wait for it so that
  // initial getUserMedia cannot race with native MultiCam startup. Once started,
  // keep this component mounted while native cameras temporarily set ready=false.
  useEffect(() => {
    if (!rearCameraReady || autoStartRequestedRef.current) return
    autoStartRequestedRef.current = true
    void start()
  }, [rearCameraReady])

  // Tracking is automatic; keep only a small status message (no control button).
  return message ? (
    <span role="status" style={{ fontSize: 10, color: '#d8c8f2', maxWidth: 280 }}>{message}</span>
  ) : null
}