import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { FaceMotionController, REST, type TrackingScores } from './faceMotion'
import modelVTubeProfile from './modelVTubeProfile.json'

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
      const fallbackRange = /^(ParamAngle[XYZ]|ParamBodyAngle[XYZ])$/.test(id) ? 30 : 1
      params.set(id, {
        index: i,
        min: raw?.minimumValues?.[i] ?? (typeof core.getParameterMinimumValue === 'function' ? core.getParameterMinimumValue(i) : -fallbackRange),
        max: raw?.maximumValues?.[i] ?? (typeof core.getParameterMaximumValue === 'function' ? core.getParameterMaximumValue(i) : fallbackRange),
      })
    }
    const keys = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen',
      'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']
    debugRef.current.parameters = keys.map((k, i) =>
      `${['口開','口形','左目','右目','頭X','頭Y','頭Z','体X','体Y','体Z'][i]}:${params.has(k) ? '有' : '無'}`
    ).join(' / ')
    // Pose parameters existing in moc3 does not prove the rig has deformers
    // attached to them. Keep writing real Cubism params and ALSO give the
    // model a restrained visible whole-avatar follow-through in Pixi. This is
    // not 3D turning and cannot substitute for a properly rigged Live2D head.
    const basePosition = { x: model.position.x, y: model.position.y }
    const basePivot = { x: model.pivot.x, y: model.pivot.y }
    const baseRotation = model.rotation
    const baseScale = { x: model.scale.x, y: model.scale.y }
    let visualReady = false
    let anchorX = basePosition.x
    let anchorY = basePosition.y
    let modelWidth = 0
    let modelHeight = 0
    let displayX = 0
    let displayY = 0
    let displayRotation = 0
    try {
      let bounds = model.getLocalBounds()
      if (!bounds || !(bounds.width > 0 && bounds.height > 0)) {
        // Some Live2D renderers report a zero local-bounds rectangle.
        const w = model.width / Math.max(Math.abs(baseScale.x), 0.0001)
        const h = model.height / Math.max(Math.abs(baseScale.y), 0.0001)
        bounds = { x: 0, y: 0, width: w, height: h }
      }
      if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height,
        basePosition.x, basePosition.y, baseScale.x, baseScale.y, baseRotation].every(Number.isFinite)
        && bounds.width > 0 && bounds.height > 0) {
        // Shift pivot to model centre while preserving its original position.
        const centerX = bounds.x + bounds.width / 2
        const centerY = bounds.y + bounds.height / 2
        const px = (centerX - basePivot.x) * baseScale.x
        const py = (centerY - basePivot.y) * baseScale.y
        const cosine = Math.cos(baseRotation)
        const sine = Math.sin(baseRotation)
        anchorX += px * cosine - py * sine
        anchorY += px * sine + py * cosine
        modelWidth = bounds.width * Math.abs(baseScale.x)
        modelHeight = bounds.height * Math.abs(baseScale.y)
        model.pivot.set(centerX, centerY)
        model.position.set(anchorX, anchorY)
        visualReady = true
      }
    } catch (error) {
      console.warn('Live2D visual follow-through unavailable:', error)
    }
    const applyVisual = (s: Scores) => {
      if (!visualReady) return
      // Always-on whole-avatar follow-through.
      // Small body sway with an expressive tilt, smoothed in rendering frames.
      // Keep these independent of the user's avatar placement and zoom.
      // Front-camera coordinates are mirrored relative to the viewer.
      // Correct horizontal translation and tilt, preserving the established
      // vertical direction (positive screen Y points downward).
      const targetX = -modelWidth * (
        (s.headX / 30) * 0.014 + (s.bodyX / 18) * 0.014)
      const targetY = modelHeight * (
        -(s.headY / 30) * 0.014 - (s.bodyY / 12) * 0.014)
      const targetRotation = -Math.max(-10, Math.min(10, s.headZ * 0.20)) * Math.PI / 180
      displayX += (targetX - displayX) * 0.15
      displayY += (targetY - displayY) * 0.15
      displayRotation += (targetRotation - displayRotation) * 0.17
      model.position.set(anchorX + displayX, anchorY + displayY)
      model.rotation = baseRotation + displayRotation
    }
    const restoreVisual = () => {
      if (!visualReady || model.destroyed) return
      model.pivot.set(basePivot.x, basePivot.y)
      model.position.set(basePosition.x, basePosition.y)
      model.rotation = baseRotation
    }
    // This exact model is configured in VTube Studio with 15 direct inputs.
    // The remaining hair, wing, fabric, earrings and arm parameters are
    // outputs of Miminoz様.physics3.json; they MUST NOT be overridden here.
    const profile = modelVTubeProfile
    const smoothed = new Map<string, number>()
    const smooth = (id: string, target: number, fpsSmoothing: number) => {
      const param = params.get(id)
      if (!param) return
      const previous = smoothed.get(id) ?? (raw?.values?.[param.index] ?? target)
      const alpha = fpsSmoothing === 0 ? 1 : 1 - Math.exp(-60 / (fpsSmoothing * 4.5))
      const value = Math.max(param.min, Math.min(param.max, previous + (target - previous) * alpha))
      smoothed.set(id, value)
      if (typeof core.setParameterValueByIndex === 'function') {
        core.setParameterValueByIndex(param.index, value)
      } else if (raw?.values) {
        raw.values[param.index] = value
      }
      debugRef.current.writes++
    }
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

    // Match VTuLog: keep normal blinking, but strengthen deliberate wide-eye poses.
    const EYE_WIDE_START = 0.75
    const EYE_WIDE_MAX = 1.9
    const enhancedEyeTarget = (mapping: (typeof profile)[number], input: number, normalTarget: number) => {
      if (mapping.Input !== 'EyeOpenLeft' && mapping.Input !== 'EyeOpenRight') return normalTarget
      const v = clamp01(input)
      if (v <= EYE_WIDE_START) return normalTarget
      const lower = mapping.InputRangeLower
      const upper = mapping.InputRangeUpper
      const startRate = upper !== lower ? (EYE_WIDE_START - lower) / (upper - lower) : 0
      const startTarget = mapping.OutputRangeLower
        + startRate * (mapping.OutputRangeUpper - mapping.OutputRangeLower)
      const t = clamp01((v - EYE_WIDE_START) / (1 - EYE_WIDE_START))
      const expressiveT = Math.pow(t, 0.65)
      const maxSupported = params.get(mapping.OutputLive2D)?.max ?? mapping.OutputRangeUpper
      const wideTarget = Math.min(EYE_WIDE_MAX, maxSupported)
      return startTarget + (wideTarget - startTarget) * expressiveT
    }
    const inputFromFace = (id: string, s: Scores): number | null => {
      switch (id) {
        // Align Cubism pose axes with the user-facing direction (not the selfie preview).
        case 'FaceAngleX': return s.headX
        case 'FaceAngleY': return -s.headY
        case 'FaceAngleZ': return -s.headZ
        case 'EyeOpenLeft': return clamp01(s.leftEye)
        case 'EyeOpenRight': return clamp01(s.rightEye)
        case 'EyeRightX': return Math.max(-1, Math.min(1, s.headX / 30))
        case 'EyeRightY': return Math.max(-1, Math.min(1, -s.headY / 30))
        case 'Brows': return clamp01((s.leftEye + s.rightEye) * 0.5)
        case 'MouthSmile': return clamp01(s.smile)
        case 'MouthOpen': return clamp01(s.mouth)
        default: return null
      }
    }
    // afterMotionUpdate occurs before Cubism physics and before the final
    // coreModel.update(). This lets the 27 native physics groups read the
    // head/eye/mouth inputs in the SAME frame, without overwriting their outputs.
    const apply = () => {
      if (!runningRef.current) return
      debugRef.current.modelUpdates++
      const s = scoresRef.current
      try {
        for (const mapping of profile) {
          if (mapping.UseBreathing || !mapping.Input) continue
          const value = inputFromFace(mapping.Input, s)
          if (value == null) continue
          const lower = mapping.InputRangeLower
          const upper = mapping.InputRangeUpper
          const rate = upper !== lower ? (value - lower) / (upper - lower) : 0
          // Keep VTube Studio eye X output mapping while compensating the camera input axis.
          // A relaxed mouth should be neutral (0), not the VTube Studio slider's -1 endpoint.
          // Otherwise a normal resting face looks pursed or puckered.
          const target = mapping.OutputLive2D === 'ParamMouthForm'
            ? clamp01(s.smile)
            : mapping.OutputRangeLower + rate * (mapping.OutputRangeUpper - mapping.OutputRangeLower)
          const enhancedTarget = enhancedEyeTarget(mapping, value, target)
          smooth(mapping.OutputLive2D, enhancedTarget, mapping.Smoothing)
        }
        // VTube Studio Auto Breath is driven by Cubism's own breath effect.
        // Don't override ParamBreath: it also drives the model's wings/arm physics.
        applyVisual(s)
      } catch (error) {
        debugRef.current.error = error instanceof Error ? error.message : String(error)
      }
    }
    internal.on('afterMotionUpdate', apply)
    return () => {
      try { internal.off?.('afterMotionUpdate', apply) } catch { /* destroyed */ }
      try { restoreVisual() } catch { /* destroyed */ }
    }
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