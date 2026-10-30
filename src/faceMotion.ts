/**
 * Pose tracking for VTuLog. Uses MediaPipe's 3D face matrix when available,
 * with a landmark-based fallback for devices that return only blendshapes.
 * No video frames are saved or displayed.
 */
export type TrackingScores = {
  mouth: number; smile: number; leftEye: number; rightEye: number
  headX: number; headY: number; headZ: number
  bodyX: number; bodyY: number; bodyZ: number
}

export const REST: TrackingScores = {
  mouth: 0, smile: 0, leftEye: 1, rightEye: 1,
  headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0,
}

type Category = { categoryName: string; score: number }
type Landmark = { x: number; y: number; z?: number }
type Result = {
  faceBlendshapes?: ReadonlyArray<{ categories?: ReadonlyArray<Category> }>
  faceLandmarks?: ReadonlyArray<ReadonlyArray<Landmark>>
  facialTransformationMatrixes?: ReadonlyArray<{ data: ArrayLike<number> }>
}
type Pose = {
  yaw: number; pitch: number; roll: number; x: number; y: number
  source: '3D行列' | '顔の特徴点'
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const deg = (radians: number) => radians * (180 / Math.PI)
const finite = (...n: number[]) => n.every(Number.isFinite)

function readPose(result: Result): Pose | null {
  const points = result.faceLandmarks?.[0]
  const eyeL = points?.[33]
  const eyeR = points?.[263]
  const nose = points?.[1]
  const chin = points?.[152]
  // Even a facial matrix without landmarks can supply head rotation.
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  if (matrix?.length === 16) {
    const yaw = deg(Math.asin(clamp(-matrix[8], -1, 1)))
    const pitch = deg(Math.atan2(matrix[9], matrix[10]))
    const roll = deg(Math.atan2(matrix[4], matrix[0]))
    // When landmarks are missing, use screen centre for body translation.
    const x = eyeL && eyeR ? (eyeL.x + eyeR.x) / 2 : 0.5
    const y = eyeL && eyeR ? (eyeL.y + eyeR.y) / 2 : 0.5
    if (finite(yaw, pitch, roll, x, y)) {
      return { yaw, pitch, roll, x, y, source: '3D行列' }
    }
  }
  // Some iOS WebViews provide blendshapes + landmarks but no 3D matrix.
  // Relative ratios work regardless of face distance, then startup calibration
  // removes differences in individual facial features.
  if (!eyeL || !eyeR || !nose || !chin) return null
  const eyeDX = eyeR.x - eyeL.x
  const eyeDY = eyeR.y - eyeL.y
  const eyeDist = Math.hypot(eyeDX, eyeDY)
  const eyeX = (eyeL.x + eyeR.x) / 2
  const eyeY = (eyeL.y + eyeR.y) / 2
  const faceH = Math.abs(chin.y - eyeY)
  if (eyeDist < 0.025 || faceH < 0.025) return null
  const yaw = clamp((nose.x - eyeX) / eyeDist * 75, -45, 45)
  const pitch = clamp((nose.y - eyeY) / faceH * 100, -75, 75)
  const roll = deg(Math.atan2(eyeDY, eyeDX))
  if (!finite(yaw, pitch, roll, eyeX, eyeY)) return null
  return { yaw, pitch, roll, x: eyeX, y: eyeY, source: '顔の特徴点' }
}

export class FaceMotionController {
  private neutral: Pose | null = null
  private calibrationFrames = 0
  private lastSeen = 0
  private lastPoseSeen = 0
  poseSource = '未取得'

  reset() {
    this.neutral = null
    this.calibrationFrames = 0
    this.lastSeen = 0
    this.lastPoseSeen = 0
    this.poseSource = '未取得'
  }

  update(result: Result, now: number): TrackingScores | null {
    const categories = result.faceBlendshapes?.[0]?.categories
    if (!categories) return null
    const get = (id: string) => categories.find(c => c.categoryName === id)?.score ?? 0
    const pose = readPose(result)
    let headX = 0, headY = 0, headZ = 0, bodyX = 0, bodyY = 0, bodyZ = 0

    if (pose) {
      this.poseSource = pose.source
      if (!this.neutral || now - this.lastPoseSeen > 1800 || this.neutral.source !== pose.source) {
        this.neutral = { ...pose }
        this.calibrationFrames = 1
      } else if (this.calibrationFrames < 8) {
        this.calibrationFrames++
        const k = 1 / this.calibrationFrames
        this.neutral = {
          yaw: this.neutral.yaw + (pose.yaw - this.neutral.yaw) * k,
          pitch: this.neutral.pitch + (pose.pitch - this.neutral.pitch) * k,
          roll: this.neutral.roll + (pose.roll - this.neutral.roll) * k,
          x: this.neutral.x + (pose.x - this.neutral.x) * k,
          y: this.neutral.y + (pose.y - this.neutral.y) * k,
          source: pose.source,
        }
      }
      const base = this.neutral
      headX = clamp((pose.yaw - base.yaw) * 1.4, -30, 30)
      headY = clamp(-(pose.pitch - base.pitch) * 1.35, -30, 30)
      headZ = clamp((pose.roll - base.roll) * 1.2, -30, 30)
      const shiftX = clamp((pose.x - base.x) * 75, -15, 15)
      const shiftY = clamp((base.y - pose.y) * 70, -12, 12)
      bodyX = clamp(headX * 0.40 + shiftX * 0.65, -18, 18)
      bodyY = clamp(headY * 0.32 + shiftY * 0.50, -12, 12)
      bodyZ = clamp(headZ * 0.40 + shiftX * 0.20, -15, 15)
      this.lastPoseSeen = now
    } else {
      this.poseSource = '姿勢なし（顔特徴点または行列なし）'
    }
    this.lastSeen = now
    return {
      mouth: clamp(get('jawOpen') * 1.5, 0, 1),
      smile: clamp(get('mouthSmileLeft') + get('mouthSmileRight'), -1, 1),
      // EyeBlink alone saturates at 1 while the eyes are merely open.
      // EyeWide is a separate MediaPipe blendshape for deliberate widening.
      // Normal open ~0.53 maps to ~1.0 on this model's 0..1.9 range.
      // Full deliberate widening maps to 1.9; blinks still reach 0.
      leftEye: clamp((1 - get('eyeBlinkLeft')) *
        (0.53 + 0.47 * clamp((get('eyeWideLeft') - 0.08) / 0.45, 0, 1)), 0, 1),
      rightEye: clamp((1 - get('eyeBlinkRight')) *
        (0.53 + 0.47 * clamp((get('eyeWideRight') - 0.08) / 0.45, 0, 1)), 0, 1),
      headX, headY, headZ, bodyX, bodyY, bodyZ,
    }
  }

  whenMissing(now: number): TrackingScores | null {
    if (this.lastSeen === 0 || now - this.lastSeen < 450) return null
    if (now - this.lastSeen > 1800) {
      this.neutral = null
      this.calibrationFrames = 0
      this.poseSource = '顔なし'
    }
    return { ...REST }
  }
}
