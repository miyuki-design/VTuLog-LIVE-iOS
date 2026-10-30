/**
 * Face pose -> Live2D parameters shared by recording and live apps.
 * A face landmark model does NOT track shoulders; body motion here is a
 * deliberately smaller, delayed follow-through of head movement and face position.
 */
export type TrackingScores = {
  mouth: number
  smile: number
  leftEye: number
  rightEye: number
  headX: number
  headY: number
  headZ: number
  bodyX: number
  bodyY: number
  bodyZ: number
}

export const REST: TrackingScores = {
  mouth: 0, smile: 0, leftEye: 1, rightEye: 1,
  headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0,
}

type Category = { categoryName: string; score: number }
type FrameResult = {
  faceBlendshapes?: ReadonlyArray<{ categories?: ReadonlyArray<Category> }>
  faceLandmarks?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
  facialTransformationMatrixes?: ReadonlyArray<{ data: ArrayLike<number> }>
}
type Pose = { yaw: number; pitch: number; roll: number; x: number; y: number }

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const degrees = (radians: number) => radians * 180 / Math.PI

function readPose(result: FrameResult): Pose | null {
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  const landmarks = result.faceLandmarks?.[0]
  if (!matrix || matrix.length < 16 || !landmarks?.[33] || !landmarks?.[263]) return null

  // Face Landmarker returns a row-major 4x4 facial pose matrix. Use its
  // rotation portion, not absolute translation (which depends on the camera).
  const yaw = degrees(Math.asin(clamp(-matrix[8], -1, 1)))
  const pitch = degrees(Math.atan2(matrix[9], matrix[10]))
  const roll = degrees(Math.atan2(matrix[4], matrix[0]))
  const x = (landmarks[33].x + landmarks[263].x) / 2
  const y = (landmarks[33].y + landmarks[263].y) / 2
  if (![yaw, pitch, roll, x, y].every(Number.isFinite)) return null
  return { yaw, pitch, roll, x, y }
}

/** Recenter on startup / after a long face loss; never store camera frames. */
export class FaceMotionController {
  private neutral: Pose | null = null
  private calibrationFrames = 0
  private lastSeen = 0

  reset() {
    this.neutral = null
    this.calibrationFrames = 0
    this.lastSeen = 0
  }

  update(result: FrameResult, now: number): TrackingScores | null {
    const categories = result.faceBlendshapes?.[0]?.categories
    if (!categories) return null
    const get = (id: string) => categories.find(c => c.categoryName === id)?.score ?? 0
    const pose = readPose(result)
    let headX = 0, headY = 0, headZ = 0, bodyX = 0, bodyY = 0, bodyZ = 0

    if (pose) {
      if (!this.neutral || (this.lastSeen > 0 && now - this.lastSeen > 2000)) {
        this.neutral = { ...pose }
        this.calibrationFrames = 1
      } else if (this.calibrationFrames < 8) {
        this.calibrationFrames += 1
        const k = 1 / this.calibrationFrames
        this.neutral = {
          yaw: this.neutral.yaw + (pose.yaw - this.neutral.yaw) * k,
          pitch: this.neutral.pitch + (pose.pitch - this.neutral.pitch) * k,
          roll: this.neutral.roll + (pose.roll - this.neutral.roll) * k,
          x: this.neutral.x + (pose.x - this.neutral.x) * k,
          y: this.neutral.y + (pose.y - this.neutral.y) * k,
        }
      }
      const base = this.neutral
      headX = clamp((pose.yaw - base.yaw) * 1.15, -30, 30)
      headY = clamp(-(pose.pitch - base.pitch) * 1.1, -25, 25)
      headZ = clamp((pose.roll - base.roll) * 1.0, -25, 25)
      // Body follows subtly; true independent torso tracking requires a pose model.
      const shiftX = clamp((pose.x - base.x) * 65, -15, 15)
      const shiftY = clamp((base.y - pose.y) * 60, -12, 12)
      bodyX = clamp(headX * 0.34 + shiftX * 0.65, -15, 15)
      bodyY = clamp(headY * 0.26 + shiftY * 0.55, -10, 10)
      bodyZ = clamp(headZ * 0.38 + shiftX * 0.3, -12, 12)
    }

    this.lastSeen = now
    return {
      mouth: clamp(get('jawOpen') * 1.5, 0, 1),
      smile: clamp(get('mouthSmileLeft') + get('mouthSmileRight'), -1, 1),
      leftEye: clamp(1 - get('eyeBlinkLeft'), 0, 1),
      rightEye: clamp(1 - get('eyeBlinkRight'), 0, 1),
      headX, headY, headZ, bodyX, bodyY, bodyZ,
    }
  }

  /** Fade to rest via the Live2D smoother instead of freezing the last frame. */
  whenMissing(now: number): TrackingScores | null {
    if (this.lastSeen === 0 || now - this.lastSeen < 450) return null
    if (now - this.lastSeen > 2000) {
      this.neutral = null
      this.calibrationFrames = 0
    }
    return { ...REST }
  }
}
