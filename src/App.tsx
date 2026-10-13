import { useState, useEffect, useRef, useCallback } from 'react'
import { useLive2D, LIVE2D_CANVAS_SIZE, type Live2DDiagnostics, type NormalizedFileInfo } from './useLive2D'

type AppState = 'idle' | 'live'

type YouTubeLiveStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'ending'
  | 'ended'

// WHIPの接続状態。配信プラットフォーム側での公開確認とは区別する。
type StreamTransportStatus =
  | 'idle'
  | 'connecting'
  | 'sending'
  | 'failed'
  | 'ending'
  | 'ended'

const PRESET_AVATARS = [
  { id: 'hana', name: 'ハナ', color: '#FF3FA4', hair: '#FF8BC8', eye: '#00E5FF' },
  { id: 'luna', name: 'ルナ', color: '#7B2FFF', hair: '#C9A0FF', eye: '#FFD700' },
  { id: 'sora', name: 'ソラ', color: '#00BFFF', hair: '#80DFFF', eye: '#FF69B4' },
]

function AvatarFace({ avatar, size = 80, animated = true }: {
  avatar: typeof PRESET_AVATARS[0]; size?: number; animated?: boolean
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
      className={animated ? 'animate-float-avatar' : ''}
      style={{ filter: `drop-shadow(0 0 8px ${avatar.color}88)` }}>
      <ellipse cx="50" cy="54" rx="30" ry="32" fill="#FFE0C8" />
      <ellipse cx="50" cy="42" rx="32" ry="28" fill={avatar.hair} />
      <path d="M20 42 Q22 18 50 16 Q78 18 80 42 Q70 30 50 28 Q30 30 20 42Z" fill={avatar.hair} />
      <ellipse cx="50" cy="56" rx="26" ry="28" fill="#FFE8D6" />
      <ellipse cx="40" cy="52" rx="6" ry="7" fill="white" />
      <ellipse cx="60" cy="52" rx="6" ry="7" fill="white" />
      <ellipse cx="40" cy="53" rx="4" ry="5" fill={avatar.eye} />
      <ellipse cx="60" cy="53" rx="4" ry="5" fill={avatar.eye} />
      <ellipse cx="41" cy="51" rx="1.5" ry="1.5" fill="white" />
      <ellipse cx="61" cy="51" rx="1.5" ry="1.5" fill="white" />
      <ellipse cx="34" cy="60" rx="5" ry="3" fill="#FFB3C8" opacity="0.6" />
      <ellipse cx="66" cy="60" rx="5" ry="3" fill="#FFB3C8" opacity="0.6" />
      <path d="M43 66 Q50 72 57 66" stroke="#E8968A" strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx="22" cy="56" rx="5" ry="6" fill="#FFE0C8" />
      <ellipse cx="78" cy="56" rx="5" ry="6" fill="#FFE0C8" />
    </svg>
  )
}

function buildPresetSVG(av: typeof PRESET_AVATARS[0]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100">
    <ellipse cx="50" cy="54" rx="30" ry="32" fill="#FFE0C8"/>
    <ellipse cx="50" cy="42" rx="32" ry="28" fill="${av.hair}"/>
    <path d="M20 42 Q22 18 50 16 Q78 18 80 42 Q70 30 50 28 Q30 30 20 42Z" fill="${av.hair}"/>
    <ellipse cx="50" cy="56" rx="26" ry="28" fill="#FFE8D6"/>
    <ellipse cx="40" cy="52" rx="6" ry="7" fill="white"/>
    <ellipse cx="60" cy="52" rx="6" ry="7" fill="white"/>
    <ellipse cx="40" cy="53" rx="4" ry="5" fill="${av.eye}"/>
    <ellipse cx="60" cy="53" rx="4" ry="5" fill="${av.eye}"/>
    <ellipse cx="41" cy="51" rx="1.5" ry="1.5" fill="white"/>
    <ellipse cx="61" cy="51" rx="1.5" ry="1.5" fill="white"/>
    <ellipse cx="34" cy="60" rx="5" ry="3" fill="#FFB3C8" opacity="0.6"/>
    <ellipse cx="66" cy="60" rx="5" ry="3" fill="#FFB3C8" opacity="0.6"/>
    <path d="M43 66 Q50 72 57 66" stroke="#E8968A" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="22" cy="56" rx="5" ry="6" fill="#FFE0C8"/>
    <ellipse cx="78" cy="56" rx="5" ry="6" fill="#FFE0C8"/>
  </svg>`
}

// ── Live2D Diagnostics Panel ──
const MONO: React.CSSProperties = { fontFamily: 'monospace', fontSize: '9px', wordBreak: 'break-all', lineHeight: 1.5 }
const MUTED = '#8B82B0'
const CYAN  = '#00E5FF'
const RED   = '#FF6B6B'
const RED2  = '#FF9999'

function DiagRow({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const icon = ok === null ? '⋯' : ok ? '✓' : '✗'
  const col  = ok === null ? MUTED : ok ? CYAN : RED
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '11px', lineHeight: 1.7 }}>
      <span style={{ color: col, width: '14px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: MUTED, flex: 1 }}>{label}</span>
      {detail && <span style={{ color: col, maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '10px' }}>{detail}</span>}
    </div>
  )
}

function Live2DDiagPanel({
  diag, status, errorMsg,
}: {
  diag: Live2DDiagnostics | null
  status: string
  errorMsg: string | null
}) {
  if (!diag && status === 'idle') return null

  const isError = status === 'error'
  const border  = isError ? '1px solid rgba(255,107,107,0.5)' : '1px solid rgba(0,229,255,0.22)'

  return (
    <div className="rounded-2xl animate-fade-in" style={{ background: 'rgba(10,8,26,0.95)', border, marginTop: '10px', padding: '10px 12px', maxHeight: '55vh', overflowY: 'auto' }}>

      <p style={{ fontSize: '10px', color: isError ? RED2 : MUTED, fontFamily: 'var(--font-display)', marginBottom: '6px', letterSpacing: '0.05em' }}>
        {status === 'loading' ? '解析中…' : isError ? '読み込みエラー' : '診断ログ'}
      </p>

      {diag && (<>
        {/* ── 1. File inventory ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <DiagRow label="選択ファイル数" ok={diag.fileCount > 0}      detail={`${diag.fileCount} 件`} />
          <DiagRow label="model3.json"   ok={diag.model3Name !== null} detail={diag.model3Name ?? '未検出'} />
          <DiagRow label=".moc3"         ok={diag.mocFile !== null}    detail={diag.mocFile ?? '未検出'} />
          <DiagRow
            label="テクスチャ"
            ok={diag.textureCount > 0 ? true : null}
            detail={diag.textureCount > 0 ? `${diag.textureCount} 枚` : '未検出'}
          />
          <DiagRow
            label="physics3.json"
            ok={diag.physicsFile !== null ? true : null}
            detail={diag.physicsFile ?? 'なし'}
          />
        </div>

        {/* ── 2. Path resolution (moc match check) ── */}
        {(diag.settingsUrl || diag.resolvedMocPath) && (
          <div style={{ marginTop: '8px', padding: '6px 8px', borderRadius: '7px', background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.12)' }}>
            <p style={{ fontSize: '9px', color: CYAN, marginBottom: '4px', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>パス解決</p>
            {diag.settingsUrl && (
              <p style={{ ...MONO, color: MUTED }}><span style={{ color: '#5A527A' }}>settings.url:      </span>{diag.settingsUrl}</p>
            )}
            {/* raw paths */}
            {diag.resolvedMocPath && (
              <p style={{ ...MONO, color: MUTED }}><span style={{ color: '#5A527A' }}>resolveURL(raw):   </span>{diag.resolvedMocPath}</p>
            )}
            {diag.mocNormalizedPath && (
              <p style={{ ...MONO, color: MUTED }}><span style={{ color: '#5A527A' }}>webkit(raw):       </span>{diag.mocNormalizedPath}</p>
            )}
            {/* encoded comparison — this is what FileLoader actually compares */}
            {diag.encodedMocPath && (
              <p style={{ ...MONO, color: diag.mocPathMatch === false ? RED : CYAN }}>
                <span style={{ color: '#5A527A' }}>resolveURL(enc):   </span>{diag.encodedMocPath}
              </p>
            )}
            {diag.encodedMocWebkit && (
              <p style={{ ...MONO, color: diag.mocPathMatch === false ? RED : CYAN }}>
                <span style={{ color: '#5A527A' }}>webkit(enc):       </span>{diag.encodedMocWebkit}
                {diag.mocPathMatch !== null && (
                  <span style={{ marginLeft: '6px', color: diag.mocPathMatch ? CYAN : RED, fontFamily: 'var(--font-display)' }}>
                    {diag.mocPathMatch ? '✓ 一致' : '✗ 不一致'}
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* ── 3. Per-file normalization log ── */}
        {diag.normalizedFiles.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <p style={{ fontSize: '9px', color: MUTED, marginBottom: '3px', fontFamily: 'var(--font-display)' }}>
              webkitRelativePath 正規化 ({diag.normalizedFiles.length}件)
            </p>
            <div style={{ maxHeight: '100px', overflowY: 'auto', padding: '4px 6px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)' }}>
              {(diag.normalizedFiles as NormalizedFileInfo[]).map((f, i) => {
                const changed = f.originalPath !== f.normalizedPath
                return (
                  <div key={i} style={{ marginBottom: '3px' }}>
                    <p style={{ ...MONO, color: changed ? CYAN : '#5A527A' }}>{f.name}</p>
                    {changed && (
                      <>
                        <p style={{ ...MONO, color: '#5A527A', paddingLeft: '8px' }}>旧: {f.originalPath || '(空)'}</p>
                        <p style={{ ...MONO, color: CYAN,     paddingLeft: '8px' }}>新: {f.normalizedPath}</p>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </>)}

      {/* Error message */}
      {isError && errorMsg && (
        <div style={{ marginTop: '8px', padding: '8px', borderRadius: '8px', background: 'rgba(255,59,59,0.12)' }}>
          <p style={{ fontSize: '10px', color: RED2, lineHeight: 1.6, whiteSpace: 'pre-line', wordBreak: 'break-all' }}>{errorMsg}</p>
        </div>
      )}

      {/* NetworkError detail */}
      {isError && diag && (diag.networkErrorUrl || diag.networkErrorStatus != null || diag.networkErrorStack) && (
        <div style={{ marginTop: '6px', padding: '7px 9px', borderRadius: '8px', background: 'rgba(255,59,59,0.07)', border: '1px solid rgba(255,107,107,0.2)' }}>
          <p style={{ fontSize: '9px', color: RED2, marginBottom: '4px', fontFamily: 'var(--font-display)' }}>NetworkError 詳細</p>
          {diag.networkErrorUrl     && <p style={{ ...MONO, color: RED }}>url: {diag.networkErrorUrl}</p>}
          {diag.networkErrorStatus != null && <p style={{ ...MONO, color: RED }}>status: {diag.networkErrorStatus}</p>}
          {diag.networkErrorAborted && <p style={{ ...MONO, color: RED2 }}>aborted: true</p>}
          {diag.networkErrorStack   && (
            <>
              <p style={{ fontSize: '9px', color: MUTED, marginTop: '4px' }}>stack:</p>
              <p style={{ ...MONO, color: '#6A6290', maxHeight: '60px', overflow: 'hidden' }}>
                {diag.networkErrorStack.split('\n').slice(0, 5).join('\n')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

function getTouchDist(t1: { clientX: number; clientY: number }, t2: { clientX: number; clientY: number }) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
}

// Internal canvas resolution (portrait 9:16)
const CW = 1080
const CH = 1920


// ── Privacy standby card: pre-render once to keep live video compositing light ──
// This is drawn INTO the captured canvas (not a UI overlay), so viewers see it.
function makePrivacyStandbyCanvas(): HTMLCanvasElement {
  const offscreen = document.createElement('canvas')
  offscreen.width = CW
  offscreen.height = CH
  const ctx = offscreen.getContext('2d')
  if (!ctx) return offscreen

  // Quiet, broadcast-style background.
  const background = ctx.createLinearGradient(0, 0, CW, CH)
  background.addColorStop(0, '#10152E')
  background.addColorStop(0.48, '#261A40')
  background.addColorStop(1, '#11142B')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, CW, CH)

  const glow = (x: number, y: number, radius: number, rgb: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
    g.addColorStop(0, `rgba(${rgb},0.19)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  glow(170, 420, 700, '123,92,250')
  glow(870, 1350, 770, '47,199,224')

  // Fine inner frame and a few small decorations.
  ctx.strokeStyle = 'rgba(222,214,255,0.16)'
  ctx.lineWidth = 2
  ctx.strokeRect(62, 84, CW - 124, CH - 168)
  ctx.strokeStyle = 'rgba(204,181,248,0.22)'
  ctx.beginPath()
  ctx.moveTo(106, 215)
  ctx.lineTo(CW - 106, 215)
  ctx.moveTo(106, CH - 210)
  ctx.lineTo(CW - 106, CH - 210)
  ctx.stroke()

  // Top brand and mode label.
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#EEE9FF'
  ctx.font = '700 42px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillText('VTuLog LIVE', 108, 156)
  ctx.fillStyle = '#BFC4E4'
  ctx.textAlign = 'right'
  ctx.font = '600 24px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillText('PRIVACY MODE', CW - 108, 157)

  // Soft rings around the camera-hidden emblem.
  ctx.strokeStyle = 'rgba(195,180,255,0.22)'
  ctx.lineWidth = 2
  for (const radius of [115, 149]) {
    ctx.beginPath()
    ctx.arc(CW / 2, 675, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(205,185,255,0.12)'
  ctx.beginPath()
  ctx.arc(CW / 2, 675, 98, 0, Math.PI * 2)
  ctx.fill()

  // A minimal crossed-out camera icon (not an emoji, consistent across devices).
  ctx.strokeStyle = '#F2EFFF'
  ctx.lineWidth = 9
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeRect(CW / 2 - 58, 641, 116, 72)
  ctx.beginPath()
  ctx.arc(CW / 2, 677, 20, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#D3B4FF'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.moveTo(CW / 2 - 76, 744)
  ctx.lineTo(CW / 2 + 76, 610)
  ctx.stroke()

  // The message is intentionally short and direct: not a connection error.
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `700 65px ${fontFamily}`
  ctx.fillText('映像を一時的に', CW / 2, 992)
  ctx.fillText('非表示にしています', CW / 2, 1085)

  ctx.fillStyle = '#C9C7E0'
  ctx.font = `400 35px ${fontFamily}`
  ctx.fillText('配信はそのまま続いています', CW / 2, 1198)

  ctx.fillStyle = '#AAA9D1'
  ctx.font = '500 27px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillText('PLEASE STAND BY', CW / 2, CH - 148)

  return offscreen
}

const SIGNALING_BASE_URL = 'https://vtulog-signal.miminoz0822.workers.dev'
const SIGNALING_ROOM_ID = 'mimi-live'
const GOOGLE_CLIENT_ID = '1076202528911-6letsd2va5jkp1tvf0hc9li0l2ebjtmc.apps.googleusercontent.com'
const GOOGLE_REDIRECT_URI = `${window.location.origin}/oauth/callback`
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube'
// Twitchタイトル変更には channel:manage:broadcast のユーザー承認が必須。
// Client ID は公開情報で、ストリームキーやClient Secretは不要。
const TWITCH_SCOPE = 'channel:manage:broadcast'
const TWITCH_TOKEN_KEY = 'vtulog-twitch-title-access-token'
const TWITCH_OAUTH_PENDING_KEY = 'vtulog-twitch-title-oauth-pending'

async function getIceServers(): Promise<RTCIceServer[]> {
  const response = await fetch(
    `${SIGNALING_BASE_URL}/turn-credentials`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(
      `TURN資格情報の取得に失敗しました: ${response.status}`
    )
  }

  const data = await response.json()

  if (
    data.status !== 'ok' ||
    !Array.isArray(data.iceServers)
  ) {
    throw new Error('TURN資格情報の形式が不正です')
  }

  return data.iceServers
}

export default function App() {
  // ── Camera ──
  const hiddenVideoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // ── Canvas ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  // ── Privacy mode (safe default: camera never appears until enabled) ──
  // This controls the actual composition canvas, not merely an HTML overlay.
  const [privacyMode, setPrivacyMode] = useState(true)
  const privacyModeRef = useRef(true)

  // ── Avatar ──
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null)
  const avatarImgRef = useRef<HTMLImageElement | null>(null)
  const presetSvgImgRef = useRef<HTMLImageElement | null>(null)
  const useCustomRef = useRef(false)
  const [useCustom, setUseCustom] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState(0)
  const [avatarName, setAvatarName] = useState('マイVTuber')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)

  // ── Avatar transform (refs for draw loop, state for UI) ──
  const vtPosRef = useRef({ x: CW - 220, y: CH - 300 })
  const vtScaleRef = useRef(1)
  const [vtScale, setVtScale] = useState(1)

  const saveAvatarTransform = useCallback(() => {
  localStorage.setItem(
    'vtulog-avatar-transform',
    JSON.stringify({
      x: vtPosRef.current.x,
      y: vtPosRef.current.y,
      scale: vtScaleRef.current,
    })
  )
}, [])
  
  // ── Drag ──
  const isDraggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })

  // ── Pinch ──
  const pinchStartDistRef = useRef(0)
  const pinchStartScaleRef = useRef(1)
  const pinchCenterRef = useRef({ x: 0, y: 0 })
  const pinchStartPosRef = useRef({ x: 0, y: 0 })

  // ── LIVE ──
  const [appState, setAppState] = useState<AppState>('idle')
  const [liveTime, setLiveTime] = useState(0)
  const [youtubeLiveStatus, setYoutubeLiveStatus] =
  useState<YouTubeLiveStatus>('idle')
  const [streamTransportStatus, setStreamTransportStatus] =
    useState<StreamTransportStatus>('idle')

  const liveStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)

  const rtcSenderRef = useRef<RTCPeerConnection | null>(null)
  const rtcReceiverRef = useRef<RTCPeerConnection | null>(null)
  const rtcPreviewRef = useRef<HTMLVideoElement>(null)

  // ── Cloudflare Stream / WHIP ──
const whipPeerRef = useRef<RTCPeerConnection | null>(null)
  const whipSessionUrlRef = useRef<string | null>(null)
const [whipUrl, setWhipUrl] = useState(() =>
  localStorage.getItem('vtulog-whip-url') ?? ''
)

const fetchLatestWhipUrl = async () => {
  try {
    const response = await fetch(
      'https://vtulog-signal.miminoz0822.workers.dev/whip-url'
    )

    if (!response.ok) {
      throw new Error(`WHIP URL取得失敗: ${response.status}`)
    }

    const data = await response.json()

    if (!data?.url || typeof data.url !== 'string') {
      throw new Error('WHIP URLが見つかりません')
    }

    setWhipUrl(data.url)
    localStorage.setItem('vtulog-whip-url', data.url)

    return data.url
  } catch (error) {
    console.error('最新WHIP URL取得失敗:', error)
    return null
  }
}
  
  const [rtcStatus, setRtcStatus] = useState<
  'idle' | 'connecting' | 'connected' | 'failed'
>('idle')
const [rtcRole, setRtcRole] = useState<'sender' | 'receiver' | null>(() => {
  const savedRole = localStorage.getItem('vtulog-rtc-role')

  if (savedRole === 'sender' || savedRole === 'receiver') {
    return savedRole
  }

  return null
})
const [offerText, setOfferText] = useState('')
const [remoteOfferText, setRemoteOfferText] = useState('')
const [answerText, setAnswerText] = useState('')
const [remoteAnswerText, setRemoteAnswerText] = useState('')
const [receiverCandidateDebug, setReceiverCandidateDebug] = useState('未取得')
const [rtcDebug, setRtcDebug] = useState({
  senderGathering: 'new',
  senderIce: 'new',
  receiverGathering: 'new',
  receiverIce: 'new',
})

const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Live2D ──
  const live2d = useLive2D()
  const useLive2DRef = useRef(false)
  const live2dFolderInputRef = useRef<HTMLInputElement>(null)

  // ── UI ──
  const [showStreamSettings, setShowStreamSettings] = useState(false)
  const [streamSettingsPage, setStreamSettingsPage] = useState<'menu' | 'youtube' | 'twitch' | 'target'>('menu')
  const [streamTarget, setStreamTarget] = useState<'youtube' | 'twitch' | null>(() => {
    const saved = localStorage.getItem('vtulog-stream-target')
    return saved === 'youtube' || saved === 'twitch' ? saved : null
  })
  const [streamTargetBusy, setStreamTargetBusy] = useState(false)
  const [streamTargetMessage, setStreamTargetMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [videoTrackInfo, setVideoTrackInfo] = useState('')
  const [micEnabled, setMicEnabled] = useState(true)
  const [youtubeComments, setYoutubeComments] = useState<
  { id: string; author: string; message: string }[]
>([])
  const [youtubeTitle, setYoutubeTitle] = useState('VTuLog LIVE')

  // 視聴中の人数。取得不可・配信未検出はnull（0人と区別する）。
  const [viewerCount, setViewerCount] = useState<number | null>(null)

  // ── Twitchコメント（匿名・読み取り専用IRC） ──
  const [twitchChannel, setTwitchChannel] = useState(() =>
    localStorage.getItem('vtulog-twitch-channel') ?? ''
  )
  const [twitchComments, setTwitchComments] = useState<
    { id: string; author: string; message: string }[]
  >([])
  const [twitchChatStatus, setTwitchChatStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  >('idle')

  useEffect(() => {
    localStorage.setItem('vtulog-twitch-channel', twitchChannel)
  }, [twitchChannel])

  // ── Twitchタイトル設定（追加OAuthはタイトル変更時のみ必要） ──
  const [twitchClientId, setTwitchClientId] = useState(() =>
    localStorage.getItem('vtulog-twitch-client-id') ?? ''
  )
  const [twitchAuthToken, setTwitchAuthToken] = useState(() =>
    localStorage.getItem(TWITCH_TOKEN_KEY) ?? ''
  )
  const [twitchBroadcasterId, setTwitchBroadcasterId] = useState('')
  const [twitchConnectedLogin, setTwitchConnectedLogin] = useState('')
  const [twitchTitle, setTwitchTitle] = useState(() =>
    localStorage.getItem('vtulog-twitch-title') ?? ''
  )
  const [twitchTitleBusy, setTwitchTitleBusy] = useState(false)
  const [twitchTitleMessage, setTwitchTitleMessage] = useState('')
  const [twitchAuthMessage, setTwitchAuthMessage] = useState('')

  useEffect(() => {
    localStorage.setItem('vtulog-twitch-client-id', twitchClientId)
  }, [twitchClientId])
  useEffect(() => {
    localStorage.setItem('vtulog-twitch-title', twitchTitle)
  }, [twitchTitle])

  const disconnectTwitchTitle = useCallback(() => {
    localStorage.removeItem(TWITCH_TOKEN_KEY)
    setTwitchAuthToken('')
    setTwitchBroadcasterId('')
    setTwitchConnectedLogin('')
    setTwitchAuthMessage('タイトル変更用のTwitch連携を解除しました')
  }, [])

  const connectTwitchTitle = useCallback(() => {
    const clientId = twitchClientId.trim()
    if (!/^[a-z0-9]{10,64}$/i.test(clientId)) {
      setTwitchAuthMessage('Twitch開発者コンソールのClient IDを入力してください')
      return
    }
    // Twitchへは配信アプリ自身のURLへ戻る。これと同じURLをTwitchに登録する。
    const redirectUri = `${window.location.origin}${window.location.pathname}`
    const state = `vtulog-twitch-${crypto.randomUUID()}`
    localStorage.setItem(TWITCH_OAUTH_PENDING_KEY, JSON.stringify({ state, startedAt: Date.now() }))
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: TWITCH_SCOPE,
      state,
    })
    window.location.assign(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`)
  }, [twitchClientId])

  const validateTwitchTitleToken = useCallback(async () => {
    if (!twitchAuthToken) {
      setTwitchBroadcasterId('')
      setTwitchConnectedLogin('')
      return
    }
    try {
      const response = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${twitchAuthToken}` },
      })
      if (response.status === 401) {
        localStorage.removeItem(TWITCH_TOKEN_KEY)
        setTwitchAuthToken('')
        setTwitchAuthMessage('Twitch連携の有効期限が切れました。再接続してください')
        return
      }
      if (!response.ok) throw new Error(`Twitch確認エラー（${response.status}）`)
      const data: { client_id?: string; user_id?: string; login?: string; scopes?: string[] } = await response.json()
      if (!data.user_id || !data.scopes?.includes(TWITCH_SCOPE) || data.client_id !== twitchClientId.trim()) {
        setTwitchBroadcasterId('')
        setTwitchConnectedLogin('')
        setTwitchAuthMessage('連携中のアプリIDまたは権限が一致しません。Twitchに再接続してください')
        return
      }
      setTwitchBroadcasterId(data.user_id)
      setTwitchConnectedLogin(data.login ?? '')
      setTwitchAuthMessage('')
    } catch (error) {
      // 通信不良ではトークンを破棄しない。次回の確認または保存時に再試行できる。
      setTwitchBroadcasterId('')
      setTwitchConnectedLogin('')
      setTwitchAuthMessage(`連携状況を確認できません：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [twitchAuthToken, twitchClientId])

  // Twitchは接続中のトークンを起動時と1時間ごとに検証する必要がある。
  useEffect(() => {
    void validateTwitchTitleToken()
    if (!twitchAuthToken) return
    const interval = setInterval(() => void validateTwitchTitleToken(), 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [twitchAuthToken, validateTwitchTitleToken])

  const saveTwitchTitle = useCallback(async () => {
    const title = twitchTitle.trim()
    const length = Array.from(title).length
    if (!title) { setTwitchTitleMessage('タイトルを入力してください'); return }
    if (length > 140) { setTwitchTitleMessage('タイトルは140文字以内にしてください'); return }
    if (!twitchAuthToken || !twitchBroadcasterId) {
      setTwitchTitleMessage('先にTwitchと連携してください')
      return
    }
    setTwitchTitleBusy(true)
    setTwitchTitleMessage('Twitchに反映中…')
    try {
      const response = await fetch(
        `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(twitchBroadcasterId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${twitchAuthToken}`,
            'Client-Id': twitchClientId.trim(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title }),
        }
      )
      if (!response.ok) {
        let detail = ''
        try {
          const data = await response.json()
          detail = data.message ?? ''
        } catch { /* エラー本文の形式が異なる場合はHTTP番号のみ表示 */ }
        if (response.status === 401) {
          localStorage.removeItem(TWITCH_TOKEN_KEY)
          setTwitchAuthToken('')
          setTwitchBroadcasterId('')
        }
        throw new Error(`${response.status}${detail ? `：${detail}` : ''}`)
      }
      // Twitchのタイトル変更は成功時204 No Content。
      setTwitchTitleMessage('✅ Twitchの配信タイトルに反映しました')
    } catch (error) {
      setTwitchTitleMessage(`変更できませんでした：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTwitchTitleBusy(false)
    }
  }, [twitchTitle, twitchAuthToken, twitchBroadcasterId, twitchClientId])

  // The stream keys remain on Oracle Cloud; only the selected destination is sent.
  const loadStreamTarget = useCallback(async () => {
    setStreamTargetBusy(true)
    setStreamTargetMessage('')
    try {
      const response = await fetch('/api/target', { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !['youtube', 'twitch'].includes(data.target)) {
        throw new Error(data.error ?? `HTTP ${response.status}`)
      }
      setStreamTarget(data.target)
      localStorage.setItem('vtulog-stream-target', data.target)
    } catch (error) {
      setStreamTarget(null)
      setStreamTargetMessage(`配信先を取得できません：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStreamTargetBusy(false)
    }
  }, [])

  const updateStreamTarget = useCallback(async (target: 'youtube' | 'twitch') => {
    if (appState === 'live' || streamTargetBusy) return
    if (!window.confirm(`配信先を${target === 'youtube' ? 'YouTube' : 'Twitch'}に変更しますか？`)) return
    setStreamTargetBusy(true)
    setStreamTargetMessage('')
    try {
      const response = await fetch('/api/target', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const data = await response.json()
      if (!response.ok || data.target !== target) {
        throw new Error(data.error ?? `HTTP ${response.status}`)
      }
      setStreamTarget(target)
      localStorage.setItem('vtulog-stream-target', target)
      setStreamTransportStatus('idle')
      setYoutubeLiveStatus('idle')
      setStreamTargetMessage(`${target === 'youtube' ? 'YouTube' : 'Twitch'}に変更しました`)
    } catch (error) {
      setStreamTargetMessage(`切り替えに失敗しました：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStreamTargetBusy(false)
    }
  }, [appState, streamTargetBusy])

  useEffect(() => {
    if (showStreamSettings && streamSettingsPage === 'target') void loadStreamTarget()
  }, [showStreamSettings, streamSettingsPage, loadStreamTarget])

  // 配信先の現在値を初回表示時にも取得する。配信設定を開かずにGO LIVEしてもコメント接続できる。
  useEffect(() => {
    void loadStreamTarget()
  }, [loadStreamTarget])

  // Twitch設定画面では配信前にコメントを試せる。配信中はTwitch選択時のみ受信。
  useEffect(() => {
    const inTwitchSettings = appState === 'idle' && showStreamSettings && streamSettingsPage === 'twitch'
    const onTwitchLive = appState === 'live' && streamTarget === 'twitch' && rtcRole !== 'receiver'
    const enabled = inTwitchSettings || onTwitchLive
    const channel = twitchChannel.trim().replace(/^@/, '').toLowerCase()

    if (!enabled) {
      setTwitchChatStatus('idle')
      return
    }
    if (!/^[a-z0-9_]{3,25}$/.test(channel)) {
      setTwitchChatStatus('error')
      return
    }

    let disposed = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let serial = 0
    setTwitchComments([])
    setTwitchChatStatus('connecting')

    const connect = () => {
      if (disposed) return
      setTwitchChatStatus(status => status === 'connecting' ? status : 'reconnecting')
      let socket: WebSocket
      try {
        socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
      } catch (error) {
        console.warn('Twitchコメント接続に失敗:', error)
        reconnectTimer = setTimeout(connect, 5000)
        return
      }
      ws = socket

      socket.onopen = () => {
        if (disposed) return
        // 匿名接続: チャットを見るだけ。TwitchのログインやOAuthは要求しない。
        socket.send('PASS SCHMOOPIIE\r\n')
        socket.send(`NICK justinfan${Math.floor(Math.random() * 999999)}\r\n`)
        socket.send('CAP REQ :twitch.tv/tags\r\n')
        socket.send(`JOIN #${channel}\r\n`)
      }

      socket.onmessage = event => {
        if (disposed || typeof event.data !== 'string') return
        const lines = event.data.split('\r\n')
        for (const line of lines) {
          if (!line) continue
          if (line.startsWith('PING ')) {
            socket.send(`PONG ${line.slice(5)}\r\n`)
            continue
          }
          if (/^:tmi\.twitch\.tv 001 /.test(line) || line.includes(` JOIN #${channel}`)) {
            setTwitchChatStatus('connected')
          }
          if (line.includes(' NOTICE ') && /authentication failed|improperly formatted/i.test(line)) {
            setTwitchChatStatus('error')
            continue
          }

          // @tags :login!login@login.tmi.twitch.tv PRIVMSG #channel :message
          const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/)
          if (!match) continue
          const [, rawTags, login, message] = match
          const displayTag = rawTags?.split(';').find(tag => tag.startsWith('display-name='))
          const displayName = displayTag?.slice('display-name='.length)
            .replace(/\\s/g, ' ')
            .replace(/\\:/g, ';')
            .replace(/\\r/g, '\r')
            .replace(/\\n/g, '\n')
            .replace(/\\\\/g, '\\')
          const idTag = rawTags?.split(';').find(tag => tag.startsWith('id='))
          serial++
          setTwitchChatStatus('connected')
          setTwitchComments(previous => [...previous, {
            id: idTag?.slice(3) || `${Date.now()}-${serial}`,
            author: displayName || login,
            message,
          }].slice(-30))
        }
      }

      socket.onerror = () => { if (!disposed) console.warn('Twitch IRC WebSocketで通信エラー') }
      socket.onclose = () => {
        if (disposed) return
        setTwitchChatStatus('reconnecting')
        reconnectTimer = setTimeout(connect, 5000)
      }
    }

    // チャンネル名入力時の連続接続を防ぐ。
    reconnectTimer = setTimeout(connect, 400)
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.onmessage = null
        ws.close()
      }
    }
  }, [appState, rtcRole, streamTarget, twitchChannel, showStreamSettings, streamSettingsPage])

  // ── Twitch / YouTube 同時視聴者数 ──
  // 映像への合成はしない。配信者側の操作画面だけに表示する。
  useEffect(() => {
    setViewerCount(null)
    if (appState !== 'live' || rtcRole === 'receiver' || !streamTarget) return

    let disposed = false
    let busy = false
    const refreshViewerCount = async () => {
      if (disposed || busy) return
      busy = true
      try {
        let count: number | null = null
        if (streamTarget === 'twitch') {
          // タイトル変更に使用する既存のTwitch認証情報を再利用。
          const login = (twitchConnectedLogin || twitchChannel).trim().replace(/^@/, '').toLowerCase()
          if (twitchAuthToken && twitchClientId.trim() && /^[a-z0-9_]{3,25}$/.test(login)) {
            const response = await fetch(
              `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
              { headers: {
                Authorization: `Bearer ${twitchAuthToken}`,
                'Client-Id': twitchClientId.trim(),
              }, cache: 'no-store' },
            )
            if (!response.ok) throw new Error(`Twitch ${response.status}`)
            const data = await response.json()
            // APIが正常に返した配信なしは0人。通信エラーは不明。
            count = data.data?.length ? data.data[0].viewer_count : 0
          }
        } else {
          const token = localStorage.getItem('youtube-access-token')
          if (token) {
            const broadcasts = await fetch(
              'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,status&broadcastStatus=active&broadcastType=all&maxResults=10',
              { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
            )
            if (!broadcasts.ok) throw new Error(`YouTube ${broadcasts.status}`)
            const broadcastData = await broadcasts.json()
            const liveId: string | undefined = broadcastData.items?.find(
              (item: { id?: string; status?: { lifeCycleStatus?: string } }) =>
                item.status?.lifeCycleStatus === 'live',
            )?.id
            if (liveId) {
              const videos = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(liveId)}`,
                { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
              )
              if (!videos.ok) throw new Error(`YouTube video ${videos.status}`)
              const videoData = await videos.json()
              const raw = videoData.items?.[0]?.liveStreamingDetails?.concurrentViewers
              // YouTubeは0人や非公開設定時にフィールドを省くことがある。
              if (raw !== undefined && raw !== null) count = Number(raw)
            }
          }
        }
        if (!disposed) setViewerCount(typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null)
      } catch (error) {
        console.warn('視聴者数を取得できません:', error)
        if (!disposed) setViewerCount(null)
      } finally {
        busy = false
      }
    }

    void refreshViewerCount()
    const interval = window.setInterval(() => void refreshViewerCount(), 30000)
    return () => { disposed = true; window.clearInterval(interval) }
  }, [appState, rtcRole, streamTarget, twitchAuthToken, twitchClientId, twitchConnectedLogin, twitchChannel])

  const twitchChatStatusLabel = {
    idle: '待機中',
    connecting: '接続中…',
    connected: '接続済み',
    reconnecting: '再接続中…',
    error: 'チャンネル名を確認してください',
  }[twitchChatStatus]

  const isCapturing = true
  const isLive = appState === 'live'
  // 実際の配信先に応じた状態表示。WHIP接続と配信先での公開状態は別物。
  const streamStatusLabel = (() => {
    if (!streamTarget) return '⚪ 配信先を確認中'
    const platform = streamTarget === 'youtube' ? 'YouTube' : 'Twitch'
    if (streamTransportStatus === 'idle') return `⚪ ${platform}配信待機中`
    if (streamTransportStatus === 'connecting') return `🟡 ${platform}へ接続中`
    if (streamTransportStatus === 'failed') return `⚠️ ${platform}への送信に失敗`
    if (streamTransportStatus === 'ending') return `🟠 ${platform}への送信終了中`
    if (streamTransportStatus === 'ended') {
      if (streamTarget === 'youtube' && youtubeLiveStatus === 'ended') return '✅ YouTube配信終了確認済み'
      if (streamTarget === 'youtube' && youtubeLiveStatus === 'ending') return '🟠 YouTube送信終了（配信終了確認中）'
      return `✅ ${platform}への送信終了`
    }
    // 送信成功のみでTwitch上での配信公開まで確認できたとは断定しない。
    if (streamTarget === 'twitch') return '🟣 Twitchへ映像送信中（公開未確認）'
    return youtubeLiveStatus === 'live'
      ? '🔴 YouTube LIVE配信中'
      : '🔴 YouTubeへ映像送信中（公開確認待ち）'
  })()
  const presetAvatar = PRESET_AVATARS[selectedPreset]
  const isLive2DActive = live2d.status === 'loaded'
  const displayAvatarName = isLive2DActive ? live2d.modelName : useCustom ? avatarName : presetAvatar.name
  const displayAvatarColor = isLive2DActive ? '#00E5FF' : useCustom ? '#FF3FA4' : presetAvatar.color

  // ── OAuth callback: TwitchとYouTubeのトークンを混同しない ──
  useEffect(() => {
    const hash = window.location.hash
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : '')
    const search = new URLSearchParams(window.location.search)
    const oauthState = params.get('state') ?? search.get('state') ?? ''

    if (oauthState.startsWith('vtulog-twitch-')) {
      // Twitch連携が戻ってきたら、そのままTwitch設定画面を開く。
      setShowStreamSettings(true)
      setStreamSettingsPage('twitch')
      const pendingRaw = localStorage.getItem(TWITCH_OAUTH_PENDING_KEY)
      localStorage.removeItem(TWITCH_OAUTH_PENDING_KEY)
      window.history.replaceState({}, document.title, window.location.pathname)
      let validState = false
      try {
        if (pendingRaw) {
          const pending: { state: string; startedAt: number } = JSON.parse(pendingRaw)
          validState = pending.state === oauthState && Date.now() - pending.startedAt < 10 * 60 * 1000
        }
      } catch { /* 不正なリクエスト状態は失敗扱い */ }
      if (!validState) {
        setTwitchAuthMessage('Twitch連携を確認できません。もう一度接続してください')
        return
      }
      if (search.get('error')) {
        setTwitchAuthMessage('Twitch連携がキャンセルされました')
        return
      }
      const accessToken = params.get('access_token')
      if (!accessToken) {
        setTwitchAuthMessage('Twitchからアクセストークンが返されませんでした')
        return
      }
      localStorage.setItem(TWITCH_TOKEN_KEY, accessToken)
      setTwitchAuthToken(accessToken)
      setTwitchAuthMessage('Twitch連携が完了しました。権限を確認します…')
      return
    }

    // 従来のYouTube OAuth動作は維持する。
    const accessToken = params.get('access_token')
    if (!accessToken) return
    localStorage.setItem('youtube-access-token', accessToken)
    window.history.replaceState({}, document.title, window.location.pathname)
    console.log('YouTube OAuth 接続成功')
  }, [])

  // ── Camera init ──
  useEffect(() => {
    let localStream: MediaStream | null = null
    ;(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } ,frameRate: { ideal: 30, max: 30 },},
          audio: false,
        })
        localStream = s
        cameraStreamRef.current = s
        const v = hiddenVideoRef.current!
        v.srcObject = s
        v.onloadedmetadata = () => { v.play(); setCameraReady(true) }
      } catch (e) {
        setCameraError((e as Error).name === 'NotAllowedError' ? 'カメラへのアクセスが拒否されました' : 'カメラを起動できませんでした')
      }
    })()
    return () => localStream?.getTracks().forEach(t => t.stop())
  }, [])

  // ── Load avatar image ──
  useEffect(() => {
    if (!customAvatarUrl) { avatarImgRef.current = null; return }
    const img = new Image()
    img.onload = () => {
      avatarImgRef.current = img
      const scale = Math.min(220 / img.naturalWidth, 220 / img.naturalHeight)
      vtScaleRef.current = scale
      setVtScale(scale)
      vtPosRef.current = {
        x: CW - img.naturalWidth * scale - 20,
        y: CH - img.naturalHeight * scale - 100,
      }
    }
    img.src = customAvatarUrl
  }, [customAvatarUrl])

  // ── Sync useCustom to ref ──
  useEffect(() => { useCustomRef.current = useCustom }, [useCustom])

  // ── Sync Live2D loaded state to ref + set initial position ──
  useEffect(() => {
  useLive2DRef.current = live2d.status === 'loaded'

  if (live2d.status === 'loaded') {
    const saved = localStorage.getItem('vtulog-avatar-transform')

    if (saved) {
      try {
        const { x, y, scale } = JSON.parse(saved)

        vtPosRef.current = { x, y }
        vtScaleRef.current = scale
        setVtScale(scale)
      } catch {
        const displayPx = 240
        const sc = displayPx / LIVE2D_CANVAS_SIZE

        vtScaleRef.current = sc
        setVtScale(sc)
        vtPosRef.current = {
          x: CW - LIVE2D_CANVAS_SIZE * sc - 20,
          y: CH - LIVE2D_CANVAS_SIZE * sc - 100,
        }
      }
    } else {
      const displayPx = 240
      const sc = displayPx / LIVE2D_CANVAS_SIZE

      vtScaleRef.current = sc
      setVtScale(sc)
      vtPosRef.current = {
        x: CW - LIVE2D_CANVAS_SIZE * sc - 20,
        y: CH - LIVE2D_CANVAS_SIZE * sc - 100,
      }
    }

    setShowAvatarPicker(false)
  }
}, [live2d.status])

  // ── Load preset SVG into Image ──
  useEffect(() => {
    const av = PRESET_AVATARS[selectedPreset]
    const blob = new Blob([buildPresetSVG(av)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image(200, 200)
    img.onload = () => {
      presetSvgImgRef.current = img
      URL.revokeObjectURL(url)
      // init position bottom-right (scale 1 = 200×200px on canvas)
      if (!useCustomRef.current) {
        vtScaleRef.current = 1
        setVtScale(1)
        vtPosRef.current = { x: CW - 200 - 20, y: CH - 200 - 100 }
      }
    }
    img.src = url
  }, [selectedPreset])

  // ── Privacy switch: hide camera immediately without rebuilding the stream ──
  const togglePrivacyMode = useCallback(() => {
    const nextPrivacyMode = !privacyModeRef.current

    // Re-exposing a camera during a public LIVE requires deliberate consent.
    if (!nextPrivacyMode && appState === 'live') {
      const confirmed = window.confirm(
        'カメラの映像を配信に表示します。\n周囲の人や職場・現在地が映っても大丈夫ですか？'
      )
      if (!confirmed) return
    }

    privacyModeRef.current = nextPrivacyMode
    setPrivacyMode(nextPrivacyMode)
  }, [appState])

  // ── Draw loop ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // Privacy background: loaded once, then reused in each animation frame.
    const privacyStandbyCanvas = makePrivacyStandbyCanvas() // fallback while loading / if missing
    const privacyRoomImage = new Image()
    let privacyRoomReady = false
    privacyRoomImage.onload = () => { privacyRoomReady = true }
    privacyRoomImage.onerror = () => { console.warn('Privacy background not found: /vampire-room.png') }
    privacyRoomImage.src = '/vampire-room.png'

    const draw = () => {
      const video = hiddenVideoRef.current
      ctx.clearRect(0, 0, CW, CH)

      // Only the canvas is broadcast. Never draw camera frames in privacy mode.
      if (privacyModeRef.current) {
        // No source-camera frame is used while privacy mode is active.
        if (privacyRoomReady) {
          // Scale to fill the portrait canvas without stretching the artwork.
          const iw = privacyRoomImage.naturalWidth
          const ih = privacyRoomImage.naturalHeight
          const ratio = Math.max(CW / iw, CH / ih)
          const dw = iw * ratio
          const dh = ih * ratio
          ctx.drawImage(privacyRoomImage, (CW - dw) / 2, (CH - dh) / 2, dw, dh)
        } else {
          ctx.drawImage(privacyStandbyCanvas, 0, 0)
        }
      } else if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth, vh = video.videoHeight
        const r = Math.max(CW / vw, CH / vh)
        const dw = vw * r, dh = vh * r
        ctx.drawImage(video, (CW - dw) / 2, (CH - dh) / 2, dw, dh)
      } else {
        ctx.fillStyle = '#0D0B1E'
        ctx.fillRect(0, 0, CW, CH)
        ctx.strokeStyle = 'rgba(0,229,255,0.06)'
        ctx.lineWidth = 1
        for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke() }
        for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke() }
      }

      const { x, y } = vtPosRef.current
      const sc = vtScaleRef.current
      if (useLive2DRef.current && live2d.pixiCanvasRef.current) {
        const sz = LIVE2D_CANVAS_SIZE * sc
        ctx.drawImage(live2d.pixiCanvasRef.current, 0, 0, LIVE2D_CANVAS_SIZE, LIVE2D_CANVAS_SIZE, x, y, sz, sz)
      } else {
        const img = useCustomRef.current ? avatarImgRef.current : presetSvgImgRef.current
        if (img && img.complete) {
          ctx.drawImage(img, x, y, img.naturalWidth * sc, img.naturalHeight * sc)
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Coordinate helpers ──
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * (CW / rect.width),
      y: (clientY - rect.top) * (CH / rect.height),
    }
  }, [])

  const hitTest = useCallback((cx: number, cy: number) => {
    const { x, y } = vtPosRef.current
    const sc = vtScaleRef.current
    if (useLive2DRef.current) {
      const sz = LIVE2D_CANVAS_SIZE * sc
      return cx >= x && cx <= x + sz && cy >= y && cy <= y + sz
    }
    const img = useCustomRef.current ? avatarImgRef.current : presetSvgImgRef.current
    if (!img) return false
    return cx >= x && cx <= x + img.naturalWidth * sc && cy >= y && cy <= y + img.naturalHeight * sc
  }, [])

  // ── Mouse drag ──
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = clientToCanvas(e.clientX, e.clientY)
    if (hitTest(pt.x, pt.y)) {
      isDraggingRef.current = true
      dragOffsetRef.current = { x: pt.x - vtPosRef.current.x, y: pt.y - vtPosRef.current.y }
      e.preventDefault()
    }
  }, [clientToCanvas, hitTest])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return
    const pt = clientToCanvas(e.clientX, e.clientY)
    vtPosRef.current = { x: pt.x - dragOffsetRef.current.x, y: pt.y - dragOffsetRef.current.y }
    e.preventDefault()
  }, [clientToCanvas])

 const onMouseUp = useCallback(() => {
  isDraggingRef.current = false
  saveAvatarTransform()
}, [saveAvatarTransform])

  // ── Touch drag + pinch ──
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const pt = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY)
      if (hitTest(pt.x, pt.y)) {
        isDraggingRef.current = true
        dragOffsetRef.current = { x: pt.x - vtPosRef.current.x, y: pt.y - vtPosRef.current.y }
        e.preventDefault()
      }
    } else if (e.touches.length === 2) {
      isDraggingRef.current = false
      pinchStartDistRef.current = getTouchDist(e.touches[0], e.touches[1])
      pinchStartScaleRef.current = vtScaleRef.current
      // pivot = midpoint of pinch in canvas coords
      const mid = clientToCanvas(
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2,
      )
      pinchCenterRef.current = mid
      pinchStartPosRef.current = { ...vtPosRef.current }
      e.preventDefault()
    }
  }, [clientToCanvas, hitTest])

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1 && isDraggingRef.current) {
      const pt = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY)
      vtPosRef.current = { x: pt.x - dragOffsetRef.current.x, y: pt.y - dragOffsetRef.current.y }
      e.preventDefault()
    } else if (e.touches.length === 2) {
      const dist = getTouchDist(e.touches[0], e.touches[1])
      const newScale = Math.max(0.08, Math.min(5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)))
      // scale around pinch center
      const ratio = newScale / pinchStartScaleRef.current
      const pivot = pinchCenterRef.current
      const startPos = pinchStartPosRef.current
      vtPosRef.current = {
        x: pivot.x - (pivot.x - startPos.x) * ratio,
        y: pivot.y - (pivot.y - startPos.y) * ratio,
      }
      vtScaleRef.current = newScale
      setVtScale(newScale)
      e.preventDefault()
    }
  }, [clientToCanvas])

  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length < 2) {
      // pinch ended — re-anchor if one finger remains
      if (e.touches.length === 1) {
        const pt = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY)
        if (hitTest(pt.x, pt.y)) {
          isDraggingRef.current = true
          dragOffsetRef.current = { x: pt.x - vtPosRef.current.x, y: pt.y - vtPosRef.current.y }
        }
      } else {
        isDraggingRef.current = false
      }
    }
  saveAvatarTransform()
}, [clientToCanvas, hitTest, saveAvatarTransform])

  // ── Scale buttons ──
  const adjustScale = useCallback((delta: number) => {
    const ns = Math.max(0.08, Math.min(5, vtScaleRef.current + delta))
    vtScaleRef.current = ns
    setVtScale(ns)
    saveAvatarTransform()
  }, [saveAvatarTransform])

  // ── YouTube OAuth ──
const connectYouTube = useCallback(() => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'token',
    scope: YOUTUBE_SCOPE,
    include_granted_scopes: 'true',
    prompt: 'consent',
  })

  window.location.href =
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}, [])

// ── YouTube LIVE + コメント取得 ──
const fetchYouTubeLive = useCallback(async (silent = false) => {
  const accessToken = localStorage.getItem('youtube-access-token')

  if (!accessToken) {
    if (!silent) {
      alert('先にYouTubeへ接続してください')
    }
    return 'error'
  }

  try {
    // 配信一覧を取得
    const broadcastResponse = await fetch(
      'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status&broadcastStatus=all&broadcastType=all&maxResults=50',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    const broadcastData = await broadcastResponse.json()

    if (!broadcastResponse.ok) {
      console.error('YouTube APIエラー:', broadcastData)

      if (!silent) {
        alert(
          `YouTube APIエラー: ${
            broadcastData.error?.message ?? broadcastResponse.status
          }`
        )
      }

      return 'error'
    }

    // live状態の配信を探す
    const liveBroadcast = (broadcastData.items ?? []).find(
      (item: any) =>
        item.status?.lifeCycleStatus === 'live' &&
        item.snippet?.liveChatId
    )

    if (liveBroadcast) setYoutubeLiveStatus('live')

    if (!liveBroadcast) {
      if (!silent) {
        alert('現在LIVE中の配信が見つかりません')
      }

      return 'waiting'
    }

    const liveChatId = liveBroadcast.snippet.liveChatId

    // コメント取得
    const chatResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${encodeURIComponent(
        liveChatId
      )}&part=snippet,authorDetails`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    const chatData = await chatResponse.json()

    if (!chatResponse.ok) {
      console.error('コメント取得エラー:', chatData)

      if (!silent) {
        alert(
          `コメント取得エラー: ${
            chatData.error?.message ?? chatResponse.status
          }`
        )
      }

      return 'error'
    }

    const comments = (chatData.items ?? [])
      .filter((item: any) => item.snippet?.displayMessage)
      .map((item: any) => ({
        id: item.id,
        author: item.authorDetails?.displayName ?? '名無し',
        message: item.snippet.displayMessage,
      }))

    setYoutubeComments(comments)

    return 'ok'
  } catch (error) {
    console.error('YouTubeコメント取得中にエラー:', error)

    if (!silent) {
      alert(
        `YouTubeコメント取得中にエラーが発生しました\n\n${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }

    return 'error'
  }
}, [])
  
  // ── YouTube テスト配信枠作成 ──
const createYouTubeTestBroadcast = useCallback(async () => {
  const accessToken = localStorage.getItem('youtube-access-token')

  if (!accessToken) {
    alert('先にYouTubeへ接続してください')
    return
  }

  try {
    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title: youtubeTitle.trim() || 'VTuLog LIVE',
            scheduledStartTime: new Date(Date.now() + 60_000).toISOString(),
          },
          status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: true,
          },
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('YouTube Broadcast作成失敗:', data)
      alert(
        `YouTube配信枠の作成に失敗しました\n\n${
          data.error?.message ?? response.status
        }`
      )
      return
    }

    console.log('YouTube Broadcast作成成功:', data)
    localStorage.setItem('youtube-broadcast-id', data.id)

    alert(
      `YouTube配信枠を作成しました！\n\n` +
      `タイトル: ${data.snippet?.title ?? '不明'}\n` +
      `Broadcast ID: ${data.id ?? '不明'}`
    )
  } catch (error) {
    console.error('YouTube Broadcast作成エラー:', error)

    alert(
      `YouTube配信枠の作成中にエラーが発生しました\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}, [youtubeTitle])

// ── YouTube 既存Live Stream取得 ──
const fetchYouTubeLiveStreams = useCallback(async () => {
  const accessToken = localStorage.getItem('youtube-access-token')

  if (!accessToken) {
    alert('先にYouTubeへ接続してください')
    return
  }

  try {
    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/liveStreams?part=id,snippet,cdn,status&mine=true&maxResults=50',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('YouTube Live Stream取得失敗:', data)
      alert(`Live Stream取得失敗: ${data.error?.message ?? response.status}`)
      return
    }

    console.log('YouTube Live Streams:', data.items)

    if (!data.items?.length) {
      alert('YouTubeの配信先が見つかりませんでした')
      return
    }

    alert(`YouTubeの配信先を ${data.items.length} 件見つけました`)
  } catch (error) {
    console.error('YouTube Live Stream取得エラー:', error)
    alert(
      `Live Stream取得エラー\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}, [])

  // ── YouTube 配信枠と配信先を紐づけ ──
const bindYouTubeBroadcast = useCallback(async () => {
  const accessToken = localStorage.getItem('youtube-access-token')

  if (!accessToken) {
    alert('先にYouTubeへ接続してください')
    return
  }

  try {
    // 今回作成した配信枠を指定
      const broadcastId = localStorage.getItem('youtube-broadcast-id')

      if (!broadcastId) {
      alert('今回作成したYouTube配信枠のIDがありません\n先に「配信枠を作成」を押してください')
      return
      }

    // 配信先を取得
    const streamResponse = await fetch(
      'https://www.googleapis.com/youtube/v3/liveStreams?part=id,snippet,status&mine=true&maxResults=50',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    const streamData = await streamResponse.json()

    if (!streamResponse.ok || !streamData.items?.length) {
      alert('YouTubeの配信先が見つかりません')
      return
    }

    const stream = streamData.items[0]

    // bind
    const bindResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(stream.id)}&part=id,contentDetails`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    const bindData = await bindResponse.json()

    if (!bindResponse.ok) {
      console.error('YouTube bind失敗:', bindData)
      alert(`配信枠の紐づけに失敗しました\n\n${bindData.error?.message ?? bindResponse.status}`)
      return
    }

    console.log('YouTube bind成功:', bindData)
    alert('YouTube配信枠と配信先を紐づけました！')
  } catch (error) {
    console.error('YouTube bindエラー:', error)
    alert(
      `配信枠の紐づけ中にエラーが発生しました\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}, [])
  
// ── YouTube コメント自動更新 ──
useEffect(() => {
  if (appState !== 'live' || streamTarget !== 'youtube') return

  let stopped = false

  const refreshComments = async () => {
    if (stopped) return

    const result = await fetchYouTubeLive(true)

    // 本当のAPIエラーが出たら、その配信中の自動取得を停止
    if (result === 'error') {
      stopped = true
      console.warn(
        'YouTubeコメント自動更新を停止しました。APIエラーが発生しています。'
      )
    }
  }

  // 配信開始直後に1回確認
  void refreshComments()

  // 30秒ごとに更新
  const interval = setInterval(() => {
    void refreshComments()
  }, 30000)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}, [appState, streamTarget, fetchYouTubeLive])

  // ── YouTube 配信終了確認 ──
useEffect(() => {
  // TwitchではYouTube APIの終了確認を絶対に呼ばない。
  if (streamTarget !== 'youtube' || youtubeLiveStatus !== 'ending') return

  const accessToken = localStorage.getItem('youtube-access-token')
  const broadcastId = localStorage.getItem('youtube-broadcast-id')

  if (!accessToken || !broadcastId) {
    console.warn('YouTube終了確認に必要な情報がありません')
    return
  }

  let stopped = false

  const checkYouTubeEnd = async () => {
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&id=${encodeURIComponent(broadcastId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        console.error('YouTube終了確認失敗:', response.status)
        return
      }

      const data = await response.json()

      if (
        !stopped &&
        data.items?.[0]?.status?.lifeCycleStatus === 'complete'
      ) {
        setYoutubeLiveStatus('ended')
      }
    } catch (error) {
      console.error('YouTube終了確認エラー:', error)
    }
  }

  void checkYouTubeEnd()

  const interval = setInterval(() => {
    void checkYouTubeEnd()
  }, 5000)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}, [youtubeLiveStatus, streamTarget])
  
  // ── Microphone ON / OFF ──
const toggleMic = useCallback(() => {
  const audioTracks = audioStreamRef.current?.getAudioTracks() ?? []

  if (audioTracks.length === 0) return

  const nextEnabled = !micEnabled

  audioTracks.forEach(track => {
    track.enabled = nextEnabled
  })

  setMicEnabled(nextEnabled)
}, [micEnabled])

  // ── Live2D folder upload ──
  const handleLive2DUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    live2d.loadModel(files)
    e.target.value = ''
  }, [live2d])

  // ── Image file upload ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setCustomAvatarUrl(ev.target!.result as string)
      setUseCustom(true)
      useCustomRef.current = true
      setShowAvatarPicker(false)
      setShowNameInput(true)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

    // ── Stop WebRTC test ──
const stopWebRTCTest = useCallback(() => {
  rtcSenderRef.current?.close()
  rtcReceiverRef.current?.close()

  rtcSenderRef.current = null
  rtcReceiverRef.current = null

  if (rtcPreviewRef.current) {
    rtcPreviewRef.current.srcObject = null
  }

  setRtcDebug({
  senderGathering: 'new',
  senderIce: 'new',
  receiverGathering: 'new',
  receiverIce: 'new',
})
  
  setRtcStatus('idle')
}, [])

const waitForIceGatheringComplete = (
  pc: RTCPeerConnection
): Promise<void> => {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', checkState)
        resolve()
      }
    }

    pc.addEventListener('icegatheringstatechange', checkState)
  })
}

// ── Cloudflare Stream / WHIP ──
const startWhipBroadcast = useCallback(async (overrideUrl?: string) => {
  const stream = liveStreamRef.current
  const url = (overrideUrl ?? whipUrl).trim()

  if (!stream) {
    setStreamTransportStatus('failed')
    alert('LIVE映像がまだ準備できていません')
    return
  }

  if (!url) {
    setStreamTransportStatus('failed')
    alert('先にWHIP URLを保存してください')
    return
  }

  setStreamTransportStatus('connecting')
  let activePeer: RTCPeerConnection | null = null
  try {
    whipPeerRef.current?.close()

    const peer = new RTCPeerConnection()
    activePeer = peer
    whipPeerRef.current = peer

    // 接続が成立してから「送信中」と表示する。Twitch/YouTube公開確認とは別。
    peer.onconnectionstatechange = () => {
      if (whipPeerRef.current !== peer) return
      if (peer.connectionState === 'connected') setStreamTransportStatus('sending')
      else if (peer.connectionState === 'failed') setStreamTransportStatus('failed')
      else if (peer.connectionState === 'disconnected') setStreamTransportStatus('connecting')
    }

    stream.getTracks().forEach(track => {
      peer.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
      })
    })

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    })

    if (!response.ok) {
      throw new Error(`WHIP接続失敗: ${response.status}`)
    }

    const sessionUrl = response.headers.get('Location')

if (sessionUrl) {
  whipSessionUrlRef.current = new URL(sessionUrl, url).toString()
  console.log('WHIP session URLを保存しました')
}

    const answer = await response.text()

    await peer.setRemoteDescription({
      type: 'answer',
      sdp: answer,
    })

    console.log('Cloudflare Stream WHIP接続成功')
    // 接続状態の通知が先に届いていた場合も反映する。
    if (whipPeerRef.current === peer && peer.connectionState === 'connected') {
      setStreamTransportStatus('sending')
    }
  } catch (error) {
    console.error('WHIP broadcast failed:', error)

    // LIVE終了後に遅延した通信エラーで「失敗」に戻さない。
    if (activePeer && whipPeerRef.current === activePeer) {
      setStreamTransportStatus('failed')
      whipPeerRef.current.close()
      whipPeerRef.current = null
    }

    alert(
      `Cloudflare Streamへの接続に失敗しました\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}, [whipUrl])
  
const createSenderOffer = useCallback(async () => {
  const stream = liveStreamRef.current

  if (!stream) {
    alert('先に GO LIVE を押してください')
    return
  }

  try {
  rtcSenderRef.current?.close()

  // 新しいOfferを作るので、前回のAnswerを破棄する
  setRemoteAnswerText('')
  setOfferText('')
  setRtcStatus('idle')

const resetResponse = await fetch(
  `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/candidates/reset`,
  {
    method: 'POST',
  }
)

if (!resetResponse.ok) {
  throw new Error(`ICE candidateのリセットに失敗しました: ${resetResponse.status}`)
}

console.log('古いICE candidateをリセットしました')
    
 const iceServers = await getIceServers()

const sender = new RTCPeerConnection({
  iceServers,
})
    rtcSenderRef.current = sender
    sender.onicecandidate = async event => {
  if (!event.candidate) return

  try {
    const response = await fetch(
      `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/candidates`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'sender',
          candidate: event.candidate.toJSON(),
        }),
      }
    )

    if (!response.ok) {
      console.error('Sender ICE candidate送信失敗:', response.status)
      return
    }

    console.log('Sender ICE candidate送信成功')
  } catch (error) {
    console.error('Sender ICE candidate送信エラー:', error)
  }
}
    
    stream.getTracks().forEach(track => {
  sender.addTransceiver(track, {
    direction: 'sendonly',
    streams: [stream],
  })
})

    const offer = await sender.createOffer()
    await sender.setLocalDescription(offer)

    await waitForIceGatheringComplete(sender)

    if (!sender.localDescription) {
      throw new Error('Offer の生成に失敗しました')
    }

    setOfferText(
      JSON.stringify(sender.localDescription)
    )
    
    const response = await fetch(
  `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/offer`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sender.localDescription),
  }
)

if (!response.ok) {
  throw new Error(`Offer の自動送信に失敗しました: ${response.status}`)
}

console.log('Offerをシグナリングサーバーへ送信しました')

// PCからAnswerが届くまで自動で待つ
for (let i = 0; i < 60; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000))

  const answerResponse = await fetch(
    `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/answer`,
    { cache: 'no-store' }
  )

  if (!answerResponse.ok) {
    continue
  }

  const data = await answerResponse.json()

  if (data.status === 'ok' && data.description) {
    await sender.setRemoteDescription(data.description)

// 一時的にTrickle ICEのreceiver candidate追加を停止
if (false) {
  let lastReceiverCandidateId = 0

  for (let candidatePoll = 0; candidatePoll < 10; candidatePoll++) {
    const candidateResponse = await fetch(
      `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/candidates?role=receiver&after=${lastReceiverCandidateId}`,
      { cache: 'no-store' }
    )

    if (candidateResponse.ok) {
      const candidateData = await candidateResponse.json()

      for (const item of candidateData.candidates ?? []) {
        await sender.addIceCandidate(item.candidate)
        lastReceiverCandidateId = item.id
        setReceiverCandidateDebug(`Receiver candidate追加成功 / ID: ${item.id}`)
        console.log('Receiver ICE candidateを追加しました:', item.id)
      }
    }

    if (
      sender.iceConnectionState === 'connected' ||
      sender.iceConnectionState === 'completed'
    ) {
      break
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
    
    setRemoteAnswerText(JSON.stringify(data.description))
    setRtcStatus('connected')

    console.log('Answerを自動取得して接続しました')
    break
  }
}
    
  } catch (error) {
    console.error('Offer creation failed:', error)
    alert('Offer の生成に失敗しました')
  }
}, [])

  const applyReceiverAnswer = useCallback(async () => {
 let answerTextToUse = remoteAnswerText.trim()

if (!answerTextToUse) {
  const response = await fetch(
    `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/answer`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    alert('シグナリングサーバーにAnswerがまだありません')
    return
  }

  const data = await response.json()

  if (data.status !== 'ok' || !data.description) {
    alert('Answerを取得できませんでした')
    return
  }

  answerTextToUse = JSON.stringify(data.description)
  setRemoteAnswerText(answerTextToUse)
}

  const sender = rtcSenderRef.current

  if (!sender) {
    alert('先にOfferを作ってください')
    return
  }

  try {
    const parsedAnswer = JSON.parse(answerTextToUse)

    const fingerprintLine = parsedAnswer.sdp
    .split('\r\n')
    .find((line: string) => line.startsWith('a=fingerprint:'))

    alert(fingerprintLine ?? 'fingerprintが見つかりません')
    
    sender.onconnectionstatechange = () => {
      if (sender.connectionState === 'connected') {
        setRtcStatus('connected')
      }

      if (
        sender.connectionState === 'failed' ||
        sender.connectionState === 'disconnected' ||
        sender.connectionState === 'closed'
      ) {
        setRtcStatus('failed')
      }
    }

    setRtcStatus('connecting')

    await sender.setRemoteDescription(parsedAnswer)
  } catch (error) {
  console.error('Answer apply failed:', error)
  setRtcStatus('failed')

  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error)

  alert(`Answerの読み込みに失敗しました\n\n${message}`)
}
}, [])
  
const createReceiverAnswer = useCallback(async () => {
 
  const response = await fetch(
  `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/offer`,
  { cache: 'no-store' }
)

if (!response.ok) {
  alert('シグナリングサーバーにOfferがまだありません')
  return
}

const data = await response.json()

if (data.status !== 'ok' || !data.description) {
  alert('Offerを取得できませんでした')
  return
}

const offerTextToUse = JSON.stringify(data.description)
setRemoteOfferText(offerTextToUse)
 const offerCandidates = [
  ...data.description.sdp.matchAll(
    /a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\w+)/g
  ),
]

console.log('Offer candidate詳細:')
offerCandidates.forEach((match, index) => {
  console.log(`Offer candidate ${index + 1}:`, {
    protocol: match[1],
    address: match[2],
    port: match[3],
    type: match[4],
  })
})
  
  try {
    rtcReceiverRef.current?.close()

    const iceServers = await getIceServers()

const receiver = new RTCPeerConnection({
  iceServers,
})

    rtcReceiverRef.current = receiver

    receiver.onicecandidate = async event => {
  if (!event.candidate) return

  try {
    const response = await fetch(
      `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/candidates`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'receiver',
          candidate: event.candidate.toJSON(),
        }),
      }
    )

    if (!response.ok) {
      console.error('Receiver ICE candidate送信失敗:', response.status)
      return
    }

    console.log('Receiver ICE candidate送信成功')
  } catch (error) {
    console.error('Receiver ICE candidate送信エラー:', error)
  }
}
    
    receiver.oniceconnectionstatechange = async () => {
  console.log('Receiver ICE:', receiver.iceConnectionState)
  if (
  receiver.iceConnectionState === 'connected' ||
  receiver.iceConnectionState === 'completed'
) {
  setRtcStatus('connected')
}

  if (
    receiver.iceConnectionState === 'connected' ||
    receiver.iceConnectionState === 'completed' ||
    receiver.iceConnectionState === 'disconnected' ||
    receiver.iceConnectionState === 'failed'
  ) {
    const stats = await receiver.getStats()

    stats.forEach(report => {
      if (report.type === 'candidate-pair') {
        console.log('Candidate pair:', {
          state: report.state,
          nominated: report.nominated,
          selected: report.selected,
          localCandidateId: report.localCandidateId,
          remoteCandidateId: report.remoteCandidateId,
          bytesReceived: report.bytesReceived,
        })
      }
    })
  }
}
    
   receiver.ontrack = event => {
  const remoteStream = event.streams[0]

  if (rtcPreviewRef.current && remoteStream) {
    rtcPreviewRef.current.srcObject = remoteStream
    rtcPreviewRef.current.play().catch(() => {})
  }
}
    const parsedOffer = JSON.parse(offerTextToUse)
    
    await receiver.setRemoteDescription(parsedOffer)

    // 一時的にTrickle ICEのsender candidate追加を停止
if (false) {
  const candidateResponse = await fetch(
    `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/candidates?role=sender&after=0`,
    { cache: 'no-store' }
  )

  if (candidateResponse.ok) {
    const candidateData = await candidateResponse.json()

    for (const item of candidateData.candidates ?? []) {
      await receiver.addIceCandidate(item.candidate)
      console.log('Sender ICE candidateを追加しました:', item.id)
    }
  }
}

    const answer = await receiver.createAnswer()
    await receiver.setLocalDescription(answer)

    await waitForIceGatheringComplete(receiver)

    if (!receiver.localDescription) {
      throw new Error('Answer の生成に失敗しました')
    }

    console.log(
  'Answer candidate数:',
  (receiver.localDescription.sdp.match(/a=candidate:/g) ?? []).length
)

    console.log(
  'Answer candidate種類:',
  [...receiver.localDescription.sdp.matchAll(/ typ (\w+)/g)].map(match => match[1])
)

const answerCandidates = [
  ...receiver.localDescription.sdp.matchAll(
    /a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\w+)/g
  ),
]

console.log('Answer candidate詳細:')
answerCandidates.forEach((match, index) => {
  console.log(`Answer candidate ${index + 1}:`, {
    protocol: match[1],
    address: match[2],
    port: match[3],
    type: match[4],
  })
})
    
    setAnswerText(
      JSON.stringify(receiver.localDescription)
    )

    const answerResponse = await fetch(
  `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/answer`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(receiver.localDescription),
  }
)

if (!answerResponse.ok) {
  throw new Error(`Answer の自動送信に失敗しました: ${answerResponse.status}`)
}

console.log('Answerをシグナリングサーバーへ送信しました')
    
  } catch (error) {
    console.error('Answer creation failed:', error)
    alert('Offerの読み込み、またはAnswerの生成に失敗しました')
  }
}, [])

useEffect(() => {
  if (appState !== 'live') return
  if (rtcRole !== 'receiver') return

  void createReceiverAnswer()

  // LIVE開始後、受信側のときだけ実行する
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [appState, rtcRole])
  
// ── WebRTC self test ──
const startWebRTCTest = useCallback(async () => {
  const stream = liveStreamRef.current

  if (!stream) {
    setRtcStatus('failed')
    return
  }

  stopWebRTCTest()
  setRtcStatus('connecting')

  try {
    const sender = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'stun:stun.cloudflare.com:3478',
    },
  ],
})

const receiver = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'stun:stun.cloudflare.com:3478',
    },
  ],
})

    rtcSenderRef.current = sender
    rtcReceiverRef.current = receiver

    setRtcDebug({
  senderGathering: sender.iceGatheringState,
  senderIce: sender.iceConnectionState,
  receiverGathering: receiver.iceGatheringState,
  receiverIce: receiver.iceConnectionState,
})

sender.onicegatheringstatechange = () => {
  setRtcDebug(prev => ({
    ...prev,
    senderGathering: sender.iceGatheringState,
  }))
}

sender.oniceconnectionstatechange = () => {
  setRtcDebug(prev => ({
    ...prev,
    senderIce: sender.iceConnectionState,
  }))
}

receiver.onicegatheringstatechange = () => {
  setRtcDebug(prev => ({
    ...prev,
    receiverGathering: receiver.iceGatheringState,
  }))
}

receiver.oniceconnectionstatechange = () => {
  setRtcDebug(prev => ({
    ...prev,
    receiverIce: receiver.iceConnectionState,
  }))
}
    
    receiver.ontrack = event => {
      const remoteStream = event.streams[0]

      if (rtcPreviewRef.current && remoteStream) {
        rtcPreviewRef.current.srcObject = remoteStream
        rtcPreviewRef.current.play().catch(() => {})

        console.log(
        'WebRTC received:',
         remoteStream.getVideoTracks().length,
        'video /',
        remoteStream.getAudioTracks().length,
        'audio'
        )
      }
    }

    receiver.onconnectionstatechange = () => {
      if (receiver.connectionState === 'connected') {
        setRtcStatus('connected')
      }

      if (
        receiver.connectionState === 'failed' ||
        receiver.connectionState === 'disconnected' ||
        receiver.connectionState === 'closed'
      ) {
        setRtcStatus('failed')
      }
    }

    stream.getTracks().forEach(track => {
      sender.addTrack(track, stream)
    })

   const offer = await sender.createOffer()
await sender.setLocalDescription(offer)

await waitForIceGatheringComplete(sender)

if (!sender.localDescription) {
  throw new Error('Offer の生成に失敗しました')
}

await receiver.setRemoteDescription(sender.localDescription)

const answer = await receiver.createAnswer()
await receiver.setLocalDescription(answer)

await waitForIceGatheringComplete(receiver)

if (!receiver.localDescription) {
  throw new Error('Answer の生成に失敗しました')
}

await sender.setRemoteDescription(receiver.localDescription)

  } catch (error) {
    console.error('WebRTC self test failed', error)
    stopWebRTCTest()
    setRtcStatus('failed')
  }
}, [stopWebRTCTest])
  
    // ── Start LIVE ──
  const startLive = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!privacyModeRef.current && !window.confirm(
      'カメラの背景映像を公開してLIVEを始めます。\n周囲の映り込みや位置の特定につながるものはありませんか？'
    )) return

   setMicError(null)
   setStreamTransportStatus('connecting')
   // YouTube固有の状態はYouTube配信時だけ更新する。
   setYoutubeLiveStatus(streamTarget === 'youtube' ? 'connecting' : 'idle')

// 前回のLIVE終了通知をリセット
await fetch(
  `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/end`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'reset',
    }),
  }
)

let audioStream: MediaStream | null = null

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      audioStreamRef.current = audioStream
    } catch {
      setMicError('マイクへのアクセスが拒否されました（映像のみLIVE）')
    }

    const canvasStream = (
      canvas as HTMLCanvasElement & {
        captureStream(fps?: number): MediaStream
      }
    ).captureStream(30)

    const videoTrack = canvasStream.getVideoTracks()[0]
    const settings = videoTrack.getSettings()

    setVideoTrackInfo(
      `Canvas: ${canvas.width}×${canvas.height} / Track: ${settings.width ?? '?'}×${settings.height ?? '?'} / ${settings.frameRate ?? '?'}fps`
    )

    const tracks = [
      ...canvasStream.getVideoTracks(),
      ...(audioStream?.getAudioTracks() ?? []),
    ]

   const liveStream = new MediaStream(tracks)

liveStreamRef.current = liveStream

if (rtcRole === 'sender') {
  void createSenderOffer()
}

const latestWhipUrl = await fetchLatestWhipUrl()

if (latestWhipUrl) {
  void startWhipBroadcast(latestWhipUrl)
} else {
  setStreamTransportStatus('failed')
}
    
    setLiveTime(0)
    setAppState('live')

    timerRef.current = setInterval(() => {
      setLiveTime(t => t + 1)
    }, 1000)
  }, [rtcRole, createSenderOffer, whipUrl, startWhipBroadcast, streamTarget])

    // ── Stop LIVE ──
 const stopLive = useCallback(async () => {
 setStreamTransportStatus('ending')
 if (streamTarget === 'youtube') setYoutubeLiveStatus('ending')

   // 相手端末へLIVE終了を通知
  if (rtcRole) {
    void fetch(
      `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/end`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: rtcRole,
        }),
      }
    ).catch(error => {
      console.error('LIVE終了通知に失敗しました:', error)
    })
  }

  stopWebRTCTest()

  // Cloudflare Stream / WHIP を終了
const whipSessionUrl = whipSessionUrlRef.current

if (whipSessionUrl) {
  try {
    await fetch(whipSessionUrl, {
      method: 'DELETE',
    })
    console.log('Cloudflare Stream WHIPセッション終了')
  } catch (error) {
    console.error('WHIPセッション終了失敗:', error)
  }

  whipSessionUrlRef.current = null
}

whipPeerRef.current?.close()
whipPeerRef.current = null

  if (timerRef.current) {
    clearInterval(timerRef.current)
    timerRef.current = null
  }

  audioStreamRef.current?.getTracks().forEach(track => track.stop())
  audioStreamRef.current = null

  liveStreamRef.current?.getTracks().forEach(track => track.stop())
  liveStreamRef.current = null

     // Twitch配信時にYouTubeの配信枠を終了させない。
  const accessToken = streamTarget === 'youtube'
    ? localStorage.getItem('youtube-access-token')
    : null

  if (accessToken) {
    try {
      const broadcastResponse = await fetch(
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,status&broadcastStatus=active&broadcastType=all&maxResults=50',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      const broadcastData = await broadcastResponse.json()

      if (!broadcastResponse.ok) {
        console.error('YouTube LIVE取得失敗:', broadcastData)
      } else {
        const liveBroadcast = (broadcastData.items ?? []).find(
          (item: any) => item.status?.lifeCycleStatus === 'live'
        )

        if (liveBroadcast?.id) {
          const transitionResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(liveBroadcast.id)}&part=status`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          )

          const transitionData = await transitionResponse.json()

          if (!transitionResponse.ok) {
            console.error('YouTube LIVE終了失敗:', transitionData)
          } else {
            console.log('YouTube LIVE終了成功:', transitionData)

            if (transitionData.status?.lifeCycleStatus === 'complete') {
                setYoutubeLiveStatus('ended')
            }
          }
        } else {
          console.log('終了対象のYouTube LIVEはありません')
        }
      }
    } catch (error) {
      console.error('YouTube LIVE終了処理エラー:', error)
    }
  }

  setAppState('idle')
  setLiveTime(0)
  setStreamTransportStatus('ended')
}, [rtcRole, stopWebRTCTest, streamTarget])

// ── Watch remote LIVE end ──
useEffect(() => {
  if (appState !== 'live' || !rtcRole) return

  const interval = setInterval(async () => {
    try {
      const response = await fetch(
        `${SIGNALING_BASE_URL}/rooms/${encodeURIComponent(SIGNALING_ROOM_ID)}/end`,
        { cache: 'no-store' }
      )

      if (!response.ok) return

      const data = await response.json()

      if (
        data.status === 'ok' &&
        data.endedBy &&
        data.endedBy !== rtcRole
      ) {
        console.log('相手端末のLIVE終了を検知:', data.endedBy)
        stopLive()
      }
    } catch (error) {
      console.error('LIVE終了確認に失敗しました:', error)
    }
  }, 1000)

  return () => clearInterval(interval)
}, [appState, rtcRole, stopLive])
  
  // ── Cleanup ──
  useEffect(() => () => {
  if (timerRef.current) clearInterval(timerRef.current)

  audioStreamRef.current?.getTracks().forEach(track => track.stop())
  liveStreamRef.current?.getTracks().forEach(track => track.stop())
}, [])

  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-body)' }}>
      {/* hidden camera video source */}
      <video ref={hiddenVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      
 <video
  ref={rtcPreviewRef}
  autoPlay
  playsInline
  style={{
    position: 'fixed',
    inset: 0,
    width: rtcRole === 'receiver' && appState === 'live' ? '100vw' : '1px',
    height: rtcRole === 'receiver' && appState === 'live' ? '100vh' : '1px',
    objectFit: 'contain',
    zIndex: rtcRole === 'receiver' && appState === 'live' ? 9999 : -1,
    background: '#000',
  }}
/>

      {rtcRole === 'receiver' && appState === 'live' && (
  <div
    style={{
      position: 'fixed',
      top: '16px',
      left: '16px',
      zIndex: 10000,
      padding: '8px 12px',
      borderRadius: '999px',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: 600,
      backdropFilter: 'blur(8px)',
    }}
  >
    {rtcStatus === 'connected' ? '● 接続済み' : '● 接続中…'}
  </div>
)}
      
      {rtcRole === 'receiver' && appState === 'live' && (
  <button
    onClick={stopLive}
    style={{
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: 10000,
      padding: '10px 16px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      backdropFilter: 'blur(8px)',
    }}
  >
    LIVE終了
  </button>
)}

{rtcRole === 'sender' && appState === 'live' && (
  <button
    onClick={toggleMic}
    style={{
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10000,
      padding: '12px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      backdropFilter: 'blur(8px)',
    }}
  >
    {micEnabled ? '🎙️ マイクON' : '🔇 マイクOFF'}
  </button>
)}

{/* hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      {/* webkitdirectory lets user pick entire model folder */}
      <input
        ref={live2dFolderInputRef}
        type="file"
        // @ts-ignore – webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleLive2DUpload}
      />

      {/* phone frame */}
      <div
      className="relative overflow-hidden flex flex-col"
        style={{
          width: 'min(390px, 100vw)',
          height: 'min(844px, 100vh)',
          WebkitOverflowScrolling: 'touch',
          borderRadius: 'min(44px, 5vw)',
          background: 'var(--color-surface)',
          boxShadow: '0 0 0 1px rgba(123,47,255,0.4), 0 0 60px rgba(123,47,255,0.15), 0 32px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* status bar */}
        <div className="flex items-center justify-between px-6 pt-3 pb-1 shrink-0 z-10"
          style={{ fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--color-muted)' }}>
          <span>9:41</span>
          <div className="flex gap-1 items-center">
            {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full" style={{ background: 'var(--color-muted)' }} />)}
            <div className="ml-1 w-5 h-2.5 rounded-sm border" style={{ borderColor: 'var(--color-muted)' }}>
              <div className="w-3/4 h-full rounded-sm" style={{ background: 'var(--color-cyan)' }} />
            </div>
          </div>
        </div>

        {/* header */}
        <div className="flex items-center justify-between px-5 pb-2 shrink-0 z-10">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '26px', fontWeight: 600, lineHeight: 1, color: 'var(--color-text)' }}>
            VTu<span style={{ color: 'var(--color-pink)' }}>Log LIVE</span>
          </h1>
          
          <div className="flex items-center gap-2">
          {cameraReady && (
            <div className="flex items-center gap-1.5 glass rounded-full px-3 py-1">
            <div
              className={`w-1.5 h-1.5 rounded-full ${isLive ? 'animate-rec-blink' : ''}`}
              style={{
              background: isLive
              ? 'var(--color-rec)'
              : 'var(--color-cyan)',
            }}
          />

      <span
        style={{
          fontSize: '10px',
          color: isLive
            ? 'var(--color-rec)'
            : 'var(--color-cyan)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
        }}
      >
        {isLive ? 'LIVE' : 'READY'}
      </span>
    </div>
  )}
</div>

          {rtcRole === 'sender' && appState === 'live' && (
  <div
    className="glass rounded-full px-3 py-1"
    style={{
      fontSize: '10px',
      color: rtcStatus === 'connected'
        ? 'var(--color-cyan)'
        : 'var(--color-muted)',
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
    }}
  >
    {rtcStatus === 'connected' ? '● PC接続済み' : '● PC接続待ち…'}
  </div>
)}
          
        </div>
        
       {/* viewfinder */}
      <div
        className="relative mx-auto rounded-2xl overflow-hidden shrink-0"
        style={{
        width: showStreamSettings && appState === 'idle'
          ? 'min(48%, 180px)'
          : 'min(65%, 240px)',
          aspectRatio: '9 / 16',
          transition: 'width 0.25s ease',
        }}
      >

          {/* ── Canvas (camera + composited avatar) ── */}
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'cover',
              display: isCapturing ? 'block' : 'none',
              cursor: useCustom && avatarImgRef.current ? 'grab' : 'default',
              touchAction: 'none',
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />

          {/* Privacy button is OUTSIDE the captured canvas (never broadcast). */}
          {rtcRole !== 'receiver' && (
            <button
              type="button"
              onClick={togglePrivacyMode}
              aria-pressed={privacyMode}
              aria-label={privacyMode
                ? 'プライバシーモードを解除してカメラ映像を表示'
                : 'プライバシーモードを有効にしてカメラ映像を隠す'}
              className="absolute rounded-xl px-3 py-2 transition-all active:scale-95"
              style={{
                top: isLive ? '64px' : '12px',
                right: '8px',
                zIndex: 24,
                minHeight: '44px',
                background: privacyMode ? 'rgba(14, 45, 48, 0.95)' : 'rgba(80, 18, 34, 0.95)',
                border: privacyMode ? '1px solid rgba(0,229,255,0.55)' : '1px solid rgba(255,99,132,0.7)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {privacyMode ? '🔒 カメラ非表示' : '📷 カメラ表示中'}
            </button>
          )}

          {/* Camera error/loading overlay */}
          {!cameraReady && isCapturing && !privacyMode && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: '#0D0B1E', zIndex: 5 }}>
              {cameraError ? (
                <>
                  <span style={{ fontSize: '36px' }}>📷</span>
                  <p style={{ fontSize: '13px', color: 'var(--color-muted)', textAlign: 'center', padding: '0 28px' }}>{cameraError}</p>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-cyan)' }} />
                  <p style={{ fontSize: '12px', color: 'var(--color-muted)' }}>カメラ起動中…</p>
                </>
              )}
            </div>
          )}

          {/* Twitchコメント: HTMLオーバーレイなので配信映像には合成されない。 */}
          {isLive && streamTarget === 'twitch' && rtcRole !== 'receiver' && (
            <div style={{
              position: 'absolute', top: '34%', left: '8px', right: '8px',
              zIndex: 22, pointerEvents: 'none',
              maxHeight: '42%', overflow: 'hidden',
              borderRadius: '10px', padding: '7px 8px',
              background: 'rgba(12,8,25,0.78)', color: '#fff',
              border: '1px solid rgba(145,70,255,0.42)',
              fontSize: '11px', lineHeight: 1.45,
            }}>
              <div style={{ color: '#cbb3ff', fontSize: '10px', fontWeight: 700, marginBottom: '4px' }}>
                💬 Twitch・{twitchChatStatusLabel}
              </div>
              {twitchComments.length > 0 ? twitchComments.slice(-3).map(comment => (
                <div key={comment.id} style={{ marginTop: '3px', overflowWrap: 'anywhere' }}>
                  <strong style={{ color: '#cbb3ff' }}>{comment.author}</strong>：{comment.message}
                </div>
              )) : (
                <div style={{ color: '#c6c0d2' }}>
                  {twitchChannel.trim() ? 'コメント待機中' : '配信設定 → Twitchでチャンネル名を入力'}
                </div>
              )}
            </div>
          )}

          {/* Recording border */}
         {isLive && (
          <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ border: '2px solid rgba(255,59,59,0.7)', zIndex: 15 }}
            />
          )}

          {/* Viewfinder corners */}
          {isCapturing && (
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 12 }}>
              {(['top-3 left-3 border-t-2 border-l-2 rounded-tl-lg',
                'top-3 right-3 border-t-2 border-r-2 rounded-tr-lg',
                'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-lg',
                'bottom-3 right-3 border-b-2 border-r-2 rounded-br-lg',
              ]).map(c => (
                <div key={c} className={`absolute w-6 h-6 ${c}`} style={{ borderColor: 'var(--color-cyan)', opacity: 0.55 }} />
              ))}
            </div>
          )}

         {/* LIVE indicator */}
      {isLive && (
        <div
          className="absolute top-4 left-4 flex items-center gap-2 glass rounded-full px-3 py-1.5"
          style={{ zIndex: 20 }}
        >
        <div
          className="w-2 h-2 rounded-full animate-rec-blink"
          style={{ background: 'var(--color-rec)' }}
        />

    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: '13px',
        color: 'var(--color-rec)',
        fontWeight: 600,
      }}
    >
      LIVE {formatTime(liveTime)}
    </span>
    {rtcRole !== 'receiver' && (
      <span style={{ fontSize: '12px', color: '#fff', whiteSpace: 'nowrap' }}
        title="同時視聴者数（約30秒ごとに更新）">
        👁 {viewerCount === null ? '—' : viewerCount}
      </span>
    )}
  </div>
)}  
          {/* ── Avatar controls (scale + picker trigger) ── */}
          {isCapturing && (
            <div className="absolute left-3 bottom-4 flex flex-col gap-2" style={{ zIndex: 20 }}>
              {/* Avatar picker button */}
              <button
                className="glass rounded-xl px-2.5 py-2 flex items-center gap-1.5 transition-all active:scale-95"
                style={{ border: `1px solid ${displayAvatarColor}44` }}
                onClick={() => setShowAvatarPicker(v => !v)}
              >
                {useCustom && customAvatarUrl ? (
                  <img src={customAvatarUrl} className="w-5 h-5 rounded-md object-cover" alt="" />
                ) : (
                  <span style={{ fontSize: '14px' }}>👤</span>
                )}
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-display)', color: displayAvatarColor }}>
                  {displayAvatarName}
                </span>
              </button>

              {/* Scale controls */}
              {(isLive2DActive || (useCustom ? !!avatarImgRef.current : !!presetSvgImgRef.current)) && (
                <div className="glass rounded-xl flex items-center gap-1 px-2 py-1.5" style={{ border: '1px solid var(--color-border)' }}>
                  <button
                    className="w-6 h-6 rounded-lg flex items-center justify-center transition-all active:scale-90"
                    style={{ background: 'rgba(255,63,164,0.2)', fontSize: '14px', lineHeight: 1, color: 'var(--color-pink)' }}
                    onClick={() => adjustScale(-0.05)}
                  >−</button>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-display)', color: 'var(--color-muted)', minWidth: '32px', textAlign: 'center' }}>
                    {Math.round(vtScale * 100)}%
                  </span>
                  <button
                    className="w-6 h-6 rounded-lg flex items-center justify-center transition-all active:scale-90"
                    style={{ background: 'rgba(255,63,164,0.2)', fontSize: '14px', lineHeight: 1, color: 'var(--color-pink)' }}
                    onClick={() => adjustScale(0.05)}
                  >+</button>
                </div>
              )}
            </div>
          )}

          {/* Avatar picker popup */}
          {showAvatarPicker && (
            <div
              className="absolute bottom-16 left-3 glass rounded-2xl p-3 animate-zoom-in"
              style={{ zIndex: 30, width: '220px', border: '1px solid var(--color-border)' }}
              onClick={e => e.stopPropagation()}
            >
              <p style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'var(--font-display)', marginBottom: '8px' }}>プリセットキャラ</p>
              <div className="flex gap-2 mb-3">
                {PRESET_AVATARS.map((av, i) => (
                  <button key={av.id}
                    className="flex-1 flex flex-col items-center gap-1 rounded-xl py-2 transition-all"
                    style={{
                      background: !useCustom && selectedPreset === i ? `${av.color}22` : 'transparent',
                      border: !useCustom && selectedPreset === i ? `1px solid ${av.color}55` : '1px solid transparent',
                    }}
                    onClick={() => { setSelectedPreset(i); setUseCustom(false); useCustomRef.current = false; useLive2DRef.current = false; live2d.cleanup(); setShowAvatarPicker(false) }}
                  >
                    <AvatarFace avatar={av} size={34} animated={false} />
                    <span style={{ fontSize: '9px', color: av.color, fontFamily: 'var(--font-display)' }}>{av.name}</span>
                  </button>
                ))}
              </div>
              <div className="h-px mb-3" style={{ background: 'var(--color-border)' }} />
              <p style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'var(--font-display)', marginBottom: '8px' }}>オリジナルVTuber</p>
              {customAvatarUrl && (
                <button
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 mb-2 transition-all"
                  style={{
                    background: useCustom ? 'rgba(255,63,164,0.15)' : 'transparent',
                    border: useCustom ? '1px solid rgba(255,63,164,0.4)' : '1px solid var(--color-border)',
                  }}
                  onClick={() => { setUseCustom(true); setShowAvatarPicker(false) }}
                >
                  <img src={customAvatarUrl} className="w-8 h-8 rounded-lg object-cover shrink-0" alt="" />
                  <span style={{ fontSize: '11px', color: 'var(--color-pink)', fontFamily: 'var(--font-display)', textAlign: 'left' }}>
                    {avatarName}
                  </span>
                  {useCustom && <span style={{ marginLeft: 'auto', fontSize: '14px' }}>✓</span>}
                </button>
              )}
              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 transition-all active:scale-95"
                style={{ background: 'rgba(255,63,164,0.1)', border: '1px dashed rgba(255,63,164,0.45)' }}
                onClick={() => { setShowAvatarPicker(false); fileInputRef.current?.click() }}
              >
                <span style={{ fontSize: '16px' }}>📁</span>
                <span style={{ fontSize: '11px', color: 'var(--color-pink)', fontFamily: 'var(--font-display)' }}>
                  {customAvatarUrl ? '画像を変更' : 'VTuberをアップロード'}
                </span>
              </button>
              {(useCustom || isLive2DActive) && (
                <p style={{ fontSize: '9px', color: 'var(--color-muted)', marginTop: '8px', textAlign: 'center' }}>
                  ドラッグで移動・ピンチで拡縮
                </p>
              )}

              {/* ── moc3 / Live2D section ── */}
              <div className="h-px mt-3 mb-3" style={{ background: 'var(--color-border)' }} />
              <p style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'var(--font-display)', marginBottom: '8px' }}>
                Live2D moc3 モデル
              </p>

              {/* Loaded model row */}
              {live2d.status === 'loaded' && (
                <button
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 mb-2 transition-all"
                  style={{
                    background: isLive2DActive ? 'rgba(0,229,255,0.15)' : 'transparent',
                    border: isLive2DActive ? '1px solid rgba(0,229,255,0.4)' : '1px solid var(--color-border)',
                  }}
                  onClick={() => { useLive2DRef.current = true; setUseCustom(false); useCustomRef.current = false; setShowAvatarPicker(false) }}
                >
                  <span style={{ fontSize: '18px' }}>🎭</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-cyan)', fontFamily: 'var(--font-display)', textAlign: 'left', flex: 1 }}>
                    {live2d.modelName}
                  </span>
                  {isLive2DActive && <span style={{ fontSize: '12px', color: 'var(--color-cyan)' }}>✓</span>}
                </button>
              )}

              {/* Folder select button */}
              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 transition-all active:scale-95"
                style={{
                  background: live2d.status === 'loading' ? 'rgba(0,229,255,0.05)' : 'rgba(0,229,255,0.08)',
                  border: '1px dashed rgba(0,229,255,0.4)',
                  opacity: live2d.status === 'loading' ? 0.6 : 1,
                }}
                onClick={() => live2dFolderInputRef.current?.click()}
                disabled={live2d.status === 'loading'}
              >
                {live2d.status === 'loading'
                  ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-cyan)' }} />
                  : <span style={{ fontSize: '16px' }}>📂</span>}
                <span style={{ fontSize: '11px', color: 'var(--color-cyan)', fontFamily: 'var(--font-display)' }}>
                  {live2d.status === 'loaded' ? 'モデルを変更' : live2d.status === 'loading' ? '読み込み中…' : 'モデルフォルダを選択'}
                </span>
              </button>
              <p style={{ fontSize: '9px', color: 'var(--color-muted)', marginTop: '6px', lineHeight: 1.6 }}>
                .model3.json を含むフォルダを丸ごと選択してください
              </p>

              {/* Diagnostics panel — shown while loading and on error */}
              {(live2d.status === 'loading' || live2d.status === 'error') && (
                <Live2DDiagPanel
                  diag={live2d.diagnostics}
                  status={live2d.status}
                  errorMsg={live2d.errorMsg}
                />
              )}
            </div>
          )}

          {/* Name input overlay */}
          {showNameInput && (
            <div className="absolute inset-0 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(13,11,30,0.88)', zIndex: 40 }}>
              <div className="glass rounded-3xl p-6 mx-6 w-full" style={{ border: '1px solid rgba(255,63,164,0.4)' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--color-text)', marginBottom: '4px', fontWeight: 600 }}>
                  アップロード完了！
                </p>
                <p style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '16px' }}>
                  VTuberの名前を設定してください
                </p>
                <input
                  type="text"
                  value={avatarName}
                  onChange={e => setAvatarName(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 outline-none mb-3"
                  style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontFamily: 'var(--font-display)', fontSize: '16px' }}
                  autoFocus
                />
                <button
                  className="w-full rounded-xl py-2.5 transition-all active:scale-95 glow-pink"
                  style={{ background: 'linear-gradient(135deg, var(--color-pink), var(--color-purple))', fontFamily: 'var(--font-display)', fontSize: '14px', color: 'white', fontWeight: 600 }}
                  onClick={() => setShowNameInput(false)}
                >
                  決定
                </button>
              </div>
            </div>
          )}

          {/* tap-outside to close picker */}
          {showAvatarPicker && (
            <div className="absolute inset-0" style={{ zIndex: 25 }} onClick={() => setShowAvatarPicker(false)} />
          )}
        </div>

        {/* mic error notice */}
        {micError && isCapturing && (
          <div className="mx-3 mt-1.5 rounded-xl px-3 py-1.5 flex items-center gap-2 shrink-0"
            style={{ background: 'rgba(255,59,59,0.1)', border: '1px solid rgba(255,59,59,0.3)' }}>
            <span style={{ fontSize: '12px' }}>🎙</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,100,100,0.9)' }}>{micError}</span>
          </div>
        )}

        {/* controls */}
<div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 pt-3 pb-6">

        {/* 配信先に合わせた送信状態・配信状態 */}
<div
  style={{
    textAlign: 'center',
    padding: '8px 12px',
    marginBottom: '12px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF',
  }}
>
  {streamStatusLabel}
</div>

          {appState === 'idle' && (
        <div className="flex flex-col items-center gap-3 animate-fade-in">
        <p
          style={{
          fontSize: '11px',
          color: 'var(--color-muted)',
          fontFamily: 'var(--font-display)',
          }}
        >
      ドラッグで移動 / ピンチ・ボタンで拡縮
    </p>

    <div className="relative">
      <div
        className="absolute inset-0 rounded-full animate-pulse-ring"
        style={{
          background: 'var(--color-pink)',
          opacity: 0.3,
        }}
      />

      <button
        className="relative w-16 h-16 rounded-full btn-record flex items-center justify-center glow-pink"
        onClick={startLive}
        disabled={!!cameraError}
        style={{ opacity: cameraError ? 0.45 : 1 }}
      >
        <div className="w-6 h-6 rounded-full bg-white/90" />
      </button>
    </div>

    <p
      style={{
        fontSize: '12px',
        color: 'var(--color-pink)',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
      }}
    >
      GO LIVE
    </p>
  </div>
)}

{appState === 'idle' && (
  <button
    onClick={() => {
      setShowStreamSettings(prev => !prev)
      setStreamSettingsPage('menu')
    }}
    style={{
      width: '100%',
      marginTop: '16px',
      padding: '12px',
      borderRadius: '12px',
      border: '1px solid rgba(0,229,255,0.3)',
      background: 'rgba(0,229,255,0.06)',
      color: 'var(--color-cyan)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    ⚙️ 配信設定 {showStreamSettings ? '▲' : '▼'}
  </button>
)}

{appState === 'idle' && showStreamSettings && (
  <div
    key={streamSettingsPage}
    style={{
      width: '100%',
      flex: '1 1 auto',
      minHeight: '120px',
      maxHeight: '360px',
      overflowY: 'auto',
      overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
      marginTop: '8px',
      paddingRight: '4px',
    }}
  >
    {streamSettingsPage === 'menu' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '4px' }}>
        <button
          onClick={() => setStreamSettingsPage('youtube')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
            border: '1px solid rgba(255,75,75,0.35)',
            background: 'rgba(255,75,75,0.08)', color: '#fff',
            fontSize: '14px', fontWeight: 600,
          }}
        >
          <span>▶ YouTube</span><span aria-hidden="true">›</span>
        </button>
        <button
          onClick={() => setStreamSettingsPage('twitch')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
            border: '1px solid rgba(145,70,255,0.40)',
            background: 'rgba(145,70,255,0.10)', color: '#fff',
            fontSize: '14px', fontWeight: 600,
          }}
        >
          <span>🟣 Twitch <span style={{ fontSize: '11px', color: '#b9a0ff' }}>（配信接続確認済み）</span></span>
          <span aria-hidden="true">›</span>
        </button>
        <button
          type="button"
          onClick={() => setStreamSettingsPage('target')}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: '12px',
            cursor: 'pointer', fontSize: '14px', fontWeight: 600,
            textAlign: 'left', color: '#fff',
            border: '1px solid rgba(0,229,255,0.35)',
            background: 'rgba(0,229,255,0.08)',
          }}
        >
          📺 YouTube ／ 💜 Twitch 配信先を変更
        </button>
      </div>
    )}

    {streamSettingsPage !== 'menu' && (
      <button
        onClick={() => setStreamSettingsPage('menu')}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.05)', color: 'var(--color-cyan)',
          textAlign: 'left', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        }}
      >
        ← 配信設定に戻る
      </button>
    )}

    {streamSettingsPage === 'target' && (
      <div style={{ marginTop: '12px', padding: '14px', borderRadius: '14px', background: 'rgba(255,255,255,0.05)' }}>
        <p style={{ color: '#fff', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
          配信先を選択（配信開始前）
        </p>
        <p style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '12px' }}>
          現在の配信先：{streamTarget === 'youtube' ? '📺 YouTube' : streamTarget === 'twitch' ? '💜 Twitch' : '未取得'}
        </p>
        {streamTarget === null && (
          <button
            type="button"
            onClick={() => { window.location.assign('/api/target?login=1') }}
            style={{
              display: 'block', width: '100%', marginBottom: '12px',
              padding: '12px', borderRadius: '10px', border: '1px solid rgba(0,229,255,0.5)',
              background: 'rgba(0,229,255,0.12)', color: '#fff', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔐 配信先の認証を開く
          </button>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          {(['youtube', 'twitch'] as const).map(target => (
            <button
              key={target}
              type="button"
              disabled={streamTargetBusy || isLive}
              onClick={() => void updateStreamTarget(target)}
              style={{
                flex: 1, padding: '13px 8px', borderRadius: '10px',
                background: target === 'youtube' ? '#C72D33' : '#9146FF',
                color: '#fff', fontWeight: 700, fontSize: '13px',
                opacity: streamTargetBusy || isLive ? 0.5 : 1,
                border: streamTarget === target ? '2px solid #fff' : '2px solid transparent',
                cursor: streamTargetBusy || isLive ? 'not-allowed' : 'pointer',
              }}
            >
              {target === 'youtube' ? '📺 YouTube' : '💜 Twitch'}
              {streamTarget === target ? ' ✓' : ''}
            </button>
          ))}
        </div>
        {streamTargetMessage && (
          <p role="status" style={{ marginTop: '10px', color: '#fff', fontSize: '12px', overflowWrap: 'anywhere' }}>
            {streamTargetMessage}
          </p>
        )}
      </div>
    )}

    {streamSettingsPage === 'twitch' && (
      <div style={{ marginTop: '12px', padding: '16px', borderRadius: '14px',
        background: 'rgba(145,70,255,0.08)', border: '1px solid rgba(145,70,255,0.25)' }}>
        <div style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>🟣 Twitch</div>
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#d2c7ed', lineHeight: 1.7 }}>
          Twitchへの映像・音声送信と、配信終了時の自動停止は確認済みです。
        </p>
        <div style={{ marginTop: '12px', padding: '12px', borderRadius: '10px',
          background: 'rgba(0,0,0,0.18)', color: '#fff', fontSize: '12px', lineHeight: 1.8 }}>
          <div>💜 Twitch配信：対応済み</div>
          <div>🔒 配信先：Oracle Cloud側で管理</div>
        </div>

        <label htmlFor="vtulog-twitch-channel" style={{
          display: 'block', marginTop: '14px', marginBottom: '6px',
          color: '#fff', fontSize: '12px', fontWeight: 600,
        }}>
          💬 コメントを読むTwitchチャンネル
        </label>
        <input
          id="vtulog-twitch-channel"
          type="text"
          value={twitchChannel}
          onChange={event => setTwitchChannel(event.target.value)}
          placeholder="例: twitchdev（@やURLは不要）"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px',
            border: '1px solid rgba(145,70,255,0.5)', background: 'rgba(0,0,0,0.3)',
            color: '#fff', fontSize: '14px',
          }}
        />
        <p style={{ marginTop: '6px', color: '#d2c7ed', fontSize: '11px' }}>
          自動保存されます。配信前でもこの画面で受信を確認できます。
        </p>
        <div style={{
          marginTop: '10px', padding: '10px', borderRadius: '10px',
          background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '11px',
        }}>
          <div style={{ color: '#cbb3ff', fontWeight: 600, marginBottom: '5px' }}>
            コメント：{twitchChatStatusLabel}
          </div>
          {twitchComments.length ? twitchComments.slice(-5).map(comment => (
            <div key={comment.id} style={{ marginBottom: '5px', overflowWrap: 'anywhere' }}>
              <strong style={{ color: '#cbb3ff' }}>{comment.author}</strong>：{comment.message}
            </div>
          )) : (
            <div style={{ color: 'var(--color-muted)' }}>まだコメントはありません</div>
          )}
        </div>
        {/* タイトル変更はコメント取得と違いTwitch側の編集権限が必須 */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(145,70,255,0.35)' }}>
          <p style={{ fontSize: '13px', color: '#fff', fontWeight: 700, marginBottom: '6px' }}>
            ✏️ Twitch配信タイトルを設定
          </p>
          <p style={{ fontSize: '11px', color: '#d2c7ed', lineHeight: 1.6, marginBottom: '9px' }}>
            コメント閲覧とは別に、タイトル変更にはTwitch公式の編集許可が必要です（期限切れ時は再接続）。
          </p>

          <label htmlFor="vtulog-twitch-client-id" style={{ display: 'block', color: '#d2c7ed', fontSize: '11px', marginBottom: '5px' }}>
            TwitchアプリのClient ID（初回登録）
          </label>
          <input
            id="vtulog-twitch-client-id"
            type="text"
            value={twitchClientId}
            onChange={event => setTwitchClientId(event.target.value.trim())}
            placeholder="Twitch開発者コンソールで取得したClient ID"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ width: '100%', padding: '10px', borderRadius: '9px', color: '#fff', fontSize: '12px',
              border: '1px solid rgba(145,70,255,0.45)', background: 'rgba(0,0,0,0.3)' }}
          />
          <p style={{ fontSize: '10px', color: 'var(--color-muted)', lineHeight: 1.6, marginTop: '7px' }}>
            開発者コンソールのOAuth Redirect URLに次のURLを登録：
          </p>
          <div style={{ fontSize: '10px', color: '#cbb3ff', overflowWrap: 'anywhere',
            background: 'rgba(0,0,0,0.3)', padding: '7px', borderRadius: '8px', marginTop: '4px' }}>
            {`${window.location.origin}${window.location.pathname}`}
          </div>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}`)}
            style={{ fontSize: '11px', marginTop: '5px', color: '#cbb3ff', textDecoration: 'underline' }}
          >
            リダイレクトURLをコピー
          </button>

          {twitchConnectedLogin ? (
            <div style={{ color: '#b4ffcf', fontSize: '11px', marginTop: '10px' }}>
              ✅ Twitch連携済み：{twitchConnectedLogin}
            </div>
          ) : (
            <button
              type="button"
              onClick={connectTwitchTitle}
              style={{ width: '100%', padding: '11px', marginTop: '10px', borderRadius: '10px',
                color: '#fff', fontSize: '12px', fontWeight: 700, background: '#9146FF' }}
            >
              🟣 Twitchに連携してタイトル変更を許可
            </button>
          )}
          {twitchAuthToken && (
            <button
              type="button"
              onClick={disconnectTwitchTitle}
              style={{ fontSize: '11px', color: '#d2c7ed', marginTop: '8px', textDecoration: 'underline' }}
            >
              Twitch連携を解除する
            </button>
          )}
          {twitchAuthMessage && (
            <p role="status" style={{ fontSize: '11px', color: '#f9cae9', marginTop: '8px', overflowWrap: 'anywhere' }}>
              {twitchAuthMessage}
            </p>
          )}

          <label htmlFor="vtulog-twitch-title" style={{ display: 'block', color: '#fff', fontSize: '12px',
            fontWeight: 600, marginTop: '16px', marginBottom: '6px' }}>
            配信タイトル
          </label>
          <input
            id="vtulog-twitch-title"
            type="text"
            value={twitchTitle}
            onChange={event => { setTwitchTitle(event.target.value); setTwitchTitleMessage('') }}
            placeholder="例：お散歩配信｜VTuLog LIVE"
            maxLength={140}
            style={{ width: '100%', padding: '11px', borderRadius: '10px', color: '#fff', fontSize: '13px',
              border: '1px solid rgba(145,70,255,0.5)', background: 'rgba(0,0,0,0.3)' }}
          />
          <p style={{ color: 'var(--color-muted)', fontSize: '10px', marginTop: '5px', textAlign: 'right' }}>
            {Array.from(twitchTitle).length} / 140文字
          </p>
          <button
            type="button"
            disabled={twitchTitleBusy || !twitchConnectedLogin}
            onClick={() => void saveTwitchTitle()}
            style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '10px',
              background: '#9146FF', color: '#fff', fontSize: '13px', fontWeight: 700,
              opacity: twitchTitleBusy || !twitchConnectedLogin ? 0.5 : 1 }}
          >
            {twitchTitleBusy ? '反映中…' : 'Twitchにタイトルを反映'}
          </button>
          {twitchTitleMessage && (
            <p role="status" style={{ fontSize: '11px', color: '#f6ebff', marginTop: '8px', overflowWrap: 'anywhere' }}>
              {twitchTitleMessage}
            </p>
          )}
          <p style={{ fontSize: '10px', color: 'var(--color-muted)', lineHeight: 1.6, marginTop: '8px' }}>
            GO LIVE前にタイトルを設定できます。配信キーやClient Secretは入力しません。
          </p>
        </div>
      </div>
    )}

    {streamSettingsPage === 'youtube' && (
      <p style={{ marginTop: '12px', fontSize: '13px', fontWeight: 600, color: '#fff' }}>
        ▶ YouTube 設定
      </p>
    )}

{streamSettingsPage === 'youtube' && (
  <div
    style={{
      width: '100%',
      marginTop: '12px',
      padding: '12px',
      borderRadius: '14px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.15)',
    }}
  >
    <input
      type="password"
      value={whipUrl}
      onChange={e => setWhipUrl(e.target.value)}
      placeholder="Cloudflare WHIP URL"
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(0,0,0,0.25)',
        color: '#fff',
        fontSize: '12px',
      }}
    />

    <button
      onClick={() => {
        localStorage.setItem('vtulog-whip-url', whipUrl.trim())
        alert('WHIP URLをこの端末に保存しました')
      }}
      style={{
        width: '100%',
        marginTop: '8px',
        padding: '10px',
        borderRadius: '999px',
        border: '1px solid rgba(0,229,255,0.3)',
        background: 'rgba(0,229,255,0.08)',
        color: 'var(--color-cyan)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      ☁️ WHIP URLを保存
    </button>
  </div>
)}
          
{streamSettingsPage === 'youtube' && (
  <button
    onClick={connectYouTube}
    style={{
      width: '100%',
      marginTop: '12px',
      padding: '10px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    ▶ YouTubeに接続
  </button>
)}

{streamSettingsPage === 'youtube' && (
  <button
    onClick={() => void fetchYouTubeLive(false)}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '10px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(0,229,255,0.3)',
      background: 'rgba(0,229,255,0.08)',
      color: 'var(--color-cyan)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    📡 YouTube LIVE確認
  </button>
)}

{streamSettingsPage === 'youtube' && (
  <input
    type="text"
    value={youtubeTitle}
    onChange={e => setYoutubeTitle(e.target.value)}
    placeholder="YouTube配信タイトル"
    maxLength={100}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '10px 12px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(0,0,0,0.25)',
      color: '#fff',
      fontSize: '13px',
      outline: 'none',
    }}
  />
)}
          
{streamSettingsPage === 'youtube' && (
  <button
    onClick={createYouTubeTestBroadcast}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '10px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(255,59,59,0.35)',
      background: 'rgba(255,59,59,0.10)',
      color: '#ff8a8a',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    🔴 YouTube配信枠を作成
  </button>
)}

{streamSettingsPage === 'youtube' && (
  <button
    onClick={fetchYouTubeLiveStreams}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '10px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(0,229,255,0.3)',
      background: 'rgba(0,229,255,0.08)',
      color: 'var(--color-cyan)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    🔎 YouTube配信先を確認
  </button>
)}

{streamSettingsPage === 'youtube' && (
  <button
    onClick={bindYouTubeBroadcast}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '10px 18px',
      borderRadius: '999px',
      border: '1px solid rgba(0,229,255,0.3)',
      background: 'rgba(0,229,255,0.08)',
      color: 'var(--color-cyan)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    🔗 YouTube配信枠と配信先を紐づけ
  </button>
)}

{/* YouTube LIVE URL */}
{streamSettingsPage === 'youtube' && (
  <button
    onClick={async () => {
      const broadcastId = localStorage.getItem('youtube-broadcast-id')

      if (!broadcastId) {
        alert('先にYouTube配信枠を作成してください')
        return
      }

      const url = `https://www.youtube.com/watch?v=${broadcastId}`

      try {
        await navigator.clipboard.writeText(url)
        alert(`YouTube LIVEのURLをコピーしました！\n\n${url}`)
      } catch {
        window.prompt('以下のURLをコピーしてください', url)
      }
    }}
    style={{
      width: '100%',
      marginTop: '8px',
      padding: '12px',
      borderRadius: '999px',
      border: '1px solid rgba(0,229,255,0.3)',
      background: 'rgba(0,229,255,0.08)',
      color: 'var(--color-cyan)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    📋 YouTube LIVEのURLをコピー
  </button>
)}
    
  </div>
)}
          
{youtubeComments.length > 0 && (
  <div
    style={{
      width: '100%',
      marginTop: '10px',
      padding: '10px 12px',
      borderRadius: '14px',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.12)',
      backdropFilter: 'blur(8px)',
    }}
  >
    {youtubeComments.slice(-5).map(comment => (
      <div
        key={comment.id}
        style={{
          fontSize: '12px',
          color: '#fff',
          lineHeight: 1.5,
          marginBottom: '4px',
        }}
      >
        <strong style={{ color: 'var(--color-cyan)' }}>
          {comment.author}
        </strong>
        ：{comment.message}
      </div>
    ))}
  </div>
)}
          
{appState === 'live' && (
  <div className="flex flex-col items-center gap-3 animate-fade-in">

    <div className="flex items-center gap-2">
      <div
        className="w-2 h-2 rounded-full animate-rec-blink"
        style={{ background: 'var(--color-rec)' }}
      />

      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '14px',
          color: 'var(--color-rec)',
        }}
      >
        LIVE {formatTime(liveTime)}
      </span>
    </div>

    <button
      className="w-20 h-20 rounded-full btn-stop flex items-center justify-center glow-rec"
      onClick={stopLive}
    >
      <div
        className="w-7 h-7 rounded-md"
        style={{ background: 'white' }}
      />
    </button>

  <div className="flex gap-2">
  <button
    onClick={() => {
  setRtcRole('sender')
  localStorage.setItem('vtulog-rtc-role', 'sender')
}}
    className="glass rounded-xl px-3 py-2"
    style={{
      fontSize: '11px',
      color:
        rtcRole === 'sender'
          ? 'var(--color-cyan)'
          : 'var(--color-muted)',
    }}
  >
    📱 送信側
  </button>

  <button
    onClick={() => {
  setRtcRole('receiver')
  localStorage.setItem('vtulog-rtc-role', 'receiver')
}}
    className="glass rounded-xl px-3 py-2"
    style={{
      fontSize: '11px',
      color:
        rtcRole === 'receiver'
          ? 'var(--color-cyan)'
          : 'var(--color-muted)',
    }}
  >
    💻 受信側
  </button>
</div>

{rtcRole === 'receiver' && (
  <div className="w-full flex flex-col gap-2">

    <textarea
      value={remoteOfferText}
      onChange={e => setRemoteOfferText(e.target.value)}
      placeholder="iPhoneで作ったOfferをここに貼り付け"
      rows={4}
      style={{
        width: '100%',
        fontSize: '9px',
        padding: '8px',
        borderRadius: '10px',
        background: 'rgba(0,0,0,0.3)',
        color: 'var(--color-cyan)',
        border: '1px solid var(--color-border)',
      }}
    />

    <button
      onClick={createReceiverAnswer}
      className="glass rounded-xl px-4 py-2"
      style={{
        fontSize: '11px',
        color: 'var(--color-cyan)',
      }}
    >
      Answerを作る
    </button>

    {answerText && (
      <textarea
        value={answerText}
        readOnly
        rows={4}
        style={{
          width: '100%',
          fontSize: '9px',
          padding: '8px',
          borderRadius: '10px',
          background: 'rgba(0,0,0,0.3)',
          color: 'var(--color-cyan)',
          border: '1px solid var(--color-border)',
        }}
      />
    )}

  </div>
)}
    
    <p
      style={{
        fontSize: '11px',
        color: 'var(--color-muted)',
      }}
    >
      タップしてLIVE終了
    </p>

  </div>
)}
         
      </div>
    </div>
  </div>
  )
}
