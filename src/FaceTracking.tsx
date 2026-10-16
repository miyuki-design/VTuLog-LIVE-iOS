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

/** Diagnostic only: front frames are analyzed in memory and never displayed, saved, or transmitted. */
export function FaceTracking({ pixiAppRef, rearStreamRef, onBeginNativeCameras, onNativeRearFrame,
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
  const [analyzing, setAnalyzing] = useState(false)
  const [driving, setDriving] = useState(false)
  const drivingRef = useRef(false)
  const [driveMessage, setDriveMessage] = useState('')
  const [faceData, setFaceData] = useState({ analyzed: 0, detected: 0, mouth: 0, smile: 0, blinkL: 0, blinkR: 0 })
  const dataRef = useRef({ analyzed: 0, detected: 0, mouth: 0, smile: 0, blinkL: 0, blinkR: 0 })
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const analyzingRef = useRef(false)
  const decodingRef = useRef(false)
  const lastFrameAtRef = useRef(0)
  const targetRef = useRef({ mouth: 0, smile: 0, leftEye: 1, rightEye: 1 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const analysisGenerationRef = useRef(0)
  const countsRef = useRef({ front: 0, rear: 0 })
  const listenerRef = useRef<PluginListenerHandle | null>(null)
  const nativeRef = useRef(false)
  const disposedRef = useRef(false)
  const runningRef = useRef(false)
  const generationRef = useRef(0)
  const busyRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCounts({ ...countsRef.current })
      setFaceData({ ...dataRef.current })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // Connect ONLY the parameter application layer to the validated face-analysis path.
  // Live2D motions/physics are updated after this event, so ticker updates can be overwritten.
  useEffect(() => {
    if (!driving || !analyzing || !cameraOn) return
    const pixi = pixiAppRef.current
    const model: any = pixi?.stage?.children?.find((child: any) => child?.internalModel?.coreModel)
    const internal: any = model?.internalModel
    const core: any = internal?.coreModel
    if (!internal?.on || !core) {
      setDriveMessage('❌ Live2Dモデルの内部パラメータを取得できません。')
      drivingRef.current = false
      return
    }
    const raw: any = core._model?.parameters
    const count: number = typeof core.getParameterCount === 'function'
      ? core.getParameterCount() : (raw?.count ?? 0)
    const params = new Map<string, { index: number; min: number; max: number }>()
    for (let i = 0; i < count; i++) {
      const v = raw?.ids?.[i] ?? (typeof core.getParameterId === 'function' ? core.getParameterId(i) : null)
      if (v == null) continue
      const id = typeof v?.getString === 'function' ? v.getString() : String(v)
      params.set(id, { index: i, min: raw?.minimumValues?.[i] ?? -1, max: raw?.maximumValues?.[i] ?? 1 })
    }
    const names = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen']
    const found = names.filter(id => params.has(id))
    setDriveMessage(found.length
      ? `Live2Dに接続：${found.length}/4パラメータ（${found.join(', ')}）`
      : '⚠️ 対応するLive2Dパラメータが見つかりません。モデル固有のIDを確認してください。')
    const smoothed = new Map<string, number>()
    const drive = (id: string, target: number, alpha: number) => {
      const param = params.get(id)
      if (!param) return
      const previous = smoothed.get(id) ?? (raw?.values?.[param.index] ?? target)
      const next = Math.max(param.min, Math.min(param.max, previous + (target - previous) * alpha))
      smoothed.set(id, next)
      if (typeof core.setParameterValueByIndex === 'function') {
        core.setParameterValueByIndex(param.index, next)
      } else if (raw?.values) {
        raw.values[param.index] = next
      }
    }
    const apply = () => {
      if (!drivingRef.current || !analyzingRef.current || !runningRef.current) return
      const s = targetRef.current
      try {
        drive('ParamMouthOpenY', s.mouth, 0.90)
        drive('ParamMouthForm', s.smile, 0.36)
        drive('ParamEyeLOpen', s.leftEye, 0.55)
        drive('ParamEyeROpen', s.rightEye, 0.55)
      } catch (error) {
        console.warn('Live2D tracking parameter update:', error)
      }
    }
    internal.on('beforeModelUpdate', apply)
    return () => { try { internal.off?.('beforeModelUpdate', apply) } catch { /* destroyed */ } }
  }, [driving, analyzing, cameraOn, pixiAppRef])

  const stopAnalysis = () => {
    analysisGenerationRef.current++
    analyzingRef.current = false
    drivingRef.current = false
    if (!disposedRef.current) setDriving(false)
    targetRef.current = { mouth: 0, smile: 0, leftEye: 1, rightEye: 1 }
    decodingRef.current = false
    const model = landmarkerRef.current
    landmarkerRef.current = null
    try { model?.close() } catch (error) { console.warn('FaceLandmarker close', error) }
    canvasRef.current = null
    if (!disposedRef.current) setAnalyzing(false)
  }

  const analyzeFrontJpeg = (jpeg: string, cameraGeneration: number) => {
    if (!analyzingRef.current || decodingRef.current || cameraGeneration !== generationRef.current) return
    const now = performance.now()
    if (now - lastFrameAtRef.current < 160) return // ~6fps: reduce load during diagnostic
    lastFrameAtRef.current = now
    decodingRef.current = true
    const analysisGeneration = analysisGenerationRef.current
    const img = new Image()
    img.onload = () => {
      try {
        if (!analyzingRef.current || analysisGeneration !== analysisGenerationRef.current ||
            cameraGeneration !== generationRef.current) return
        const canvas = canvasRef.current
        const landmarker = landmarkerRef.current
        if (!canvas || !landmarker) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        // Maintain the portrait rotation validated in the original native tracking code.
        const sw = img.naturalWidth, sh = img.naturalHeight
        const scale = Math.min(canvas.width / sh, canvas.height / sw)
        ctx.save()
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(-Math.PI / 2)
        ctx.drawImage(img, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale)
        ctx.restore()
        const categories = landmarker.detectForVideo(canvas, performance.now()).faceBlendshapes?.[0]?.categories
        const d = dataRef.current
        d.analyzed++
        if (categories) {
          const score = (key: string) => categories.find(c => c.categoryName === key)?.score ?? 0
          d.detected++
          d.mouth = score('jawOpen')
          d.smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2
          d.blinkL = score('eyeBlinkLeft')
          d.blinkR = score('eyeBlinkRight')
          targetRef.current = {
            mouth: Math.min(1, Math.max(0, d.mouth * 1.5)),
            smile: Math.min(1, Math.max(-1, d.smile * 2)),
            leftEye: 1 - d.blinkL,
            rightEye: 1 - d.blinkR,
          }
        }
      } catch (error) {
        if (!disposedRef.current) setMessage(`⚠️ 顔解析エラー：${error instanceof Error ? error.message : String(error)}`)
      } finally { decodingRef.current = false }
    }
    img.onerror = () => { decodingRef.current = false }
    img.src = `data:image/jpeg;base64,${jpeg}`
  }

  const startAnalysis = async () => {
    if (!runningRef.current || busyRef.current || analyzingRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('MediaPipeを起動し、顔解析を準備中…')
    const analysisGeneration = ++analysisGenerationRef.current
    try {
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm')
      if (disposedRef.current || analysisGeneration !== analysisGenerationRef.current) return
      const model = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
      })
      if (disposedRef.current || analysisGeneration !== analysisGenerationRef.current) { model.close(); return }
      landmarkerRef.current = model
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 320
      canvasRef.current = canvas
      dataRef.current = { analyzed: 0, detected: 0, mouth: 0, smile: 0, blinkL: 0, blinkR: 0 }
      lastFrameAtRef.current = 0
      analyzingRef.current = true
      setAnalyzing(true)
      setMessage('✅ 顔解析中。前面カメラに顔を向けて数値の変化を確認してください。')
    } catch (error) {
      stopAnalysis()
      if (!disposedRef.current) setMessage(`❌ 顔解析を開始できません：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busyRef.current = false
      if (!disposedRef.current) setBusy(false)
    }
  }

  const stopCameras = async (restore = true) => {
    stopAnalysis()
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
    stopAnalysis()
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
          countsRef.current.front++
          if (analyzingRef.current) analyzeFrontJpeg(jpeg, generation)
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
        {cameraOn && (
          <button type="button" style={buttonStyle} disabled={busy}
            onClick={() => {
              if (analyzing) {
                stopAnalysis()
                setMessage('顔解析を停止。前後カメラは引き続き稼働中です。')
              } else { void startAnalysis() }
            }}>
            {analyzing ? '顔解析だけ停止' : '顔認識・表情数値テスト'}
          </button>
        )}
      </div>
      {analyzing && (
        <button type="button" style={{ ...buttonStyle, borderColor: '#55ddcb' }}
          onClick={() => {
            if (drivingRef.current) {
              drivingRef.current = false
              setDriving(false)
              setDriveMessage('Live2Dへの反映を停止しました。顔の数値解析は継続中です。')
            } else {
              drivingRef.current = true
              setDriveMessage('Live2Dに接続中…')
              setDriving(true)
            }
          }}>
          {driving ? 'Live2D表情反映を停止' : 'Live2D表情反映テスト'}
        </button>
      )}
      <span role="status" style={{ fontSize: 10, color: '#d8c8f2', maxWidth: 310, overflowWrap: 'anywhere' }}>{message}</span>
      {driveMessage && <span role="status" style={{ fontSize: 10, color: '#a4f0d3', overflowWrap: 'anywhere' }}>{driveMessage}</span>}
      {cameraOn && <span style={{ fontSize: 11, color: '#a4f0d3' }}>受信フレーム数：前面 {counts.front} / 背面 {counts.rear}（Live2D反映：{driving ? 'ON' : 'OFF'}）</span>}
      {analyzing && (
        <div style={{ fontSize: 11, lineHeight: 1.7, color: '#a4f0d3', overflowWrap: 'anywhere' }}>
          解析 {faceData.analyzed} 回 / 顔検出 {faceData.detected} 回
          <div>口の開き: {(faceData.mouth * 100).toFixed(0)}% / 笑顔: {(faceData.smile * 100).toFixed(0)}%</div>
          <div>左まばたき: {(faceData.blinkL * 100).toFixed(0)}% / 右まばたき: {(faceData.blinkR * 100).toFixed(0)}%</div>
          <div style={{ color: '#c8b4ea' }}>※ 前面映像は画面表示・保存・送信しません。Live2D反映はテストボタンで個別に切り替えます。</div>
        </div>
      )}
    </div>
  )
}
