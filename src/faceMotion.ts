/**
 * Pose and gaze tracking for VTuLog. Uses MediaPipe's 3D face matrix when
 * available and tracks the irises / eye-look blendshapes independently of head
 * rotation. Face images are never displayed, uploaded or stored.
 */
export type TrackingScores = {
  mouth: number; smile: number; leftEye: number; rightEye: number
  headX: number; headY: number; headZ: number
  bodyX: number; bodyY: number; bodyZ: number
  eyeX: number; eyeY: number
}

export const REST: TrackingScores = {
  mouth: 0, smile: 0, leftEye: 1, rightEye: 1,
  headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0,
  eyeX: 0, eyeY: 0,
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
type Gaze = { x: number; y: number }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const deg = (radians: number) => radians * (180 / Math.PI)
const finite = (...n: number[]) => n.every(Number.isFinite)

function readPose(result: Result): Pose | null {
  const points = result.faceLandmarks?.[0]
  const eyeL = points?.[33]
  const eyeR = points?.[263]
  const nose = points?.[1]
  const chin = points?.[152]
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  if (matrix?.length === 16) {
    const yaw = deg(Math.asin(clamp(-matrix[8], -1, 1)))
    const pitch = deg(Math.atan2(matrix[9], matrix[10]))
    const roll = deg(Math.atan2(matrix[4], matrix[0]))
    const x = eyeL && eyeR ? (eyeL.x + eyeR.x) / 2 : 0.5
    const y = eyeL && eyeR ? (eyeL.y + eyeR.y) / 2 : 0.5
    if (finite(yaw, pitch, roll, x, y)) {
      return { yaw, pitch, roll, x, y, source: '3D行列' }
    }
  }
  // On iOS, the landmark fallback also works when 3D matrices are absent.
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

/**
 * Estimate gaze from iris centres within each eye, rather than the position of
 * the head. Using eye-local coordinates removes most head translation, scale
 * and roll. The landmarks are defined by MediaPipe's 478-point face mesh:
 * 468 = image-left iris; 473 = image-right iris.
 */
function readIrisGaze(points: ReadonlyArray<Landmark> | undefined, get: (id: string) => number): Gaze | null {
  if (!points || points.length < 478) return null
  const eyes = [
    { iris: 468, left: 33, right: 133, top: 159, bottom: 145, blink: 'eyeBlinkRight' },
    { iris: 473, left: 362, right: 263, top: 386, bottom: 374, blink: 'eyeBlinkLeft' },
  ] as const
  let sumX = 0, sumY = 0, available = 0
  for (const eye of eyes) {
    // Iris coordinates become unstable while eyelids are closed.
    if (get(eye.blink) > 0.45) continue
    const iris = points[eye.iris]
    const left = points[eye.left]
    const right = points[eye.right]
    const top = points[eye.top]
    const bottom = points[eye.bottom]
    if (!iris || !left || !right || !top || !bottom ||
        !finite(iris.x, iris.y, left.x, left.y, right.x, right.y,
          top.x, top.y, bottom.x, bottom.y)) continue
    const dx = right.x - left.x
    const dy = right.y - left.y
    const width = Math.hypot(dx, dy)
    if (width < 0.022) continue
    const axisX = dx / width
    const axisY = dy / width
    const centreX = (left.x + right.x) / 2
    const centreY = (top.y + bottom.y) / 2
    const centreVerticalX = (top.x + bottom.x) / 2
    // Projection onto eye's horizontal / vertical axes. Image-right is +X;
    // image-up is +Y. These match the existing VTube Studio profile inputs.
    const offsetX = ((iris.x - centreX) * axisX + (iris.y - (left.y + right.y) / 2) * axisY)
    const offsetY = (-(iris.x - centreVerticalX) * axisY + (iris.y - centreY) * axisX)
    const x = offsetX / (width * 0.32)
    const y = -offsetY / (width * 0.19)
    if (!finite(x, y) || Math.abs(x) > 2.3 || Math.abs(y) > 2.3) continue
    sumX += clamp(x, -1.2, 1.2)
    sumY += clamp(y, -1.2, 1.2)
    available++
  }
  return available ? { x: sumX / available, y: sumY / available } : null
}

/** MediaPipe's eyeLook coefficients remain usable when iris pixels are unclear. */
function readBlendshapeGaze(categories: ReadonlyArray<Category> | undefined): Gaze | null {
  if (!categories) return null
  const byName = new Map(categories.map(c => [c.categoryName, c.score]))
  const names = ['eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookInRight', 'eyeLookOutRight',
    'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight']
  if (!names.every(name => byName.has(name) && Number.isFinite(byName.get(name)))) return null
  const get = (name: string) => byName.get(name) ?? 0
  // The input is the camera image (not a mirrored selfie preview).
  // Looking image-right = left eye outward + right eye inward.
  const x = (get('eyeLookOutLeft') + get('eyeLookInRight')
    - get('eyeLookInLeft') - get('eyeLookOutRight')) * 1.1
  const y = (get('eyeLookUpLeft') + get('eyeLookUpRight')
    - get('eyeLookDownLeft') - get('eyeLookDownRight')) * 1.1
  return { x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2) }
}

function readGaze(result: Result, get: (id: string) => number): Gaze | null {
  const categories = result.faceBlendshapes?.[0]?.categories
  // Don't move the pupils under shut eyelids. Keep their last position until
  // they reopen, and fade back to centre if the face disappears.
  if ((get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2 > 0.65) return null
  const blend = readBlendshapeGaze(categories)
  const iris = readIrisGaze(result.faceLandmarks?.[0], get)
  if (blend && iris) {
    // Blendshapes tolerate low-resolution iPhone front-camera JPEGs better;
    // the iris adds small, independent eye movements without head coupling.
    return { x: blend.x * 0.72 + iris.x * 0.28,
      y: blend.y * 0.72 + iris.y * 0.28 }
  }
  return blend ?? iris
}

export class FaceMotionController {
  private neutral: Pose | null = null
  private calibrationFrames = 0
  private neutralGaze: Gaze | null = null
  private gazeCalibrationFrames = 0
  private gazeSmooth: Gaze = { x: 0, y: 0 }
  private lastGazeSeen = 0
  private lastSeen = 0
  private lastPoseSeen = 0
  poseSource = '未取得'

  reset() {
    this.neutral = null
    this.calibrationFrames = 0
    this.neutralGaze = null
    this.gazeCalibrationFrames = 0
    this.gazeSmooth = { x: 0, y: 0 }
    this.lastGazeSeen = 0
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

    // Eye gaze has its own neutral calibration; rotating the head must not
    // automatically drag the pupils. Don't recalibrate on every blink.
    const gaze = readGaze(result, get)
    if (gaze && finite(gaze.x, gaze.y)) {
      if (!this.neutralGaze || now - this.lastGazeSeen > 1800) {
        this.neutralGaze = { ...gaze }
        this.gazeCalibrationFrames = 1
        this.gazeSmooth = { x: 0, y: 0 }
      } else if (this.gazeCalibrationFrames < 8) {
        this.gazeCalibrationFrames++
        const k = 1 / this.gazeCalibrationFrames
        this.neutralGaze = {
          x: this.neutralGaze.x + (gaze.x - this.neutralGaze.x) * k,
          y: this.neutralGaze.y + (gaze.y - this.neutralGaze.y) * k,
        }
      }
      // Map ordinary gaze excursions to the FULL -1..+1 model eye-ball range.
      // The previous 1.65 gain seldom reached either endpoint on an iPhone.
      // Iris / blendshape fusion stays independent of head rotation.
      const centredX = clamp((gaze.x - this.neutralGaze.x) * 10.0, -1, 1)
      const centredY = clamp((gaze.y - this.neutralGaze.y) * 10.0, -1, 1)
      const targetX = Math.abs(centredX) < 0.045 ? 0 : centredX
      const targetY = Math.abs(centredY) < 0.045 ? 0 : centredY
      // Smooth the measured gaze, without introducing an on-screen control.
      const alpha = 0.38
      this.gazeSmooth.x += (targetX - this.gazeSmooth.x) * alpha
      this.gazeSmooth.y += (targetY - this.gazeSmooth.y) * alpha
      this.lastGazeSeen = now
    } else if (this.lastGazeSeen && now - this.lastGazeSeen > 450) {
      this.gazeSmooth.x *= 0.75
      this.gazeSmooth.y *= 0.75
    }

    this.lastSeen = now
    return {
      // Increase jaw-opening sensitivity while retaining the model's 0..2.1 output cap.
      mouth: clamp(get('jawOpen') * 2.4, 0, 1),
      // Japanese 'i' has a horizontally stretched mouth even without a big smile.
      // Fuse smile and mouth-stretch blendshapes instead of relying on smile alone.
      // Keep a relaxed mouth at 0 so it does not become puckered at rest.
      smile: clamp(Math.max(
        (get('mouthSmileLeft') + get('mouthSmileRight')) * 1.25,
        (get('mouthStretchLeft') + get('mouthStretchRight')) * 3.0,
      ) - get('mouthPucker') * 1.5,
  -1, 1
),
      // EyeBlink alone saturates at 1 while the eyes are merely open.
      // EyeWide is a separate MediaPipe blendshape for deliberate widening.
      // Normal open ~0.53 maps to ~1.0 on this model's 0..1.9 range.
      // Full deliberate widening maps to 1.9; blinks still reach 0.
      leftEye: clamp((1 - get('eyeBlinkLeft')) *
        (0.53 + 0.47 * clamp((get('eyeWideLeft') - 0.08) / 0.45, 0, 1)), 0, 1),
      rightEye: clamp((1 - get('eyeBlinkRight')) *
        (0.53 + 0.47 * clamp((get('eyeWideRight') - 0.08) / 0.45, 0, 1)), 0, 1),
      headX, headY, headZ, bodyX, bodyY, bodyZ,
      eyeX: clamp(this.gazeSmooth.x, -1, 1), eyeY: clamp(this.gazeSmooth.y, -1, 1),
    }
  }

  whenMissing(now: number): TrackingScores | null {
    if (this.lastSeen === 0 || now - this.lastSeen < 450) return null
    if (now - this.lastSeen > 1800) {
      this.neutral = null
      this.calibrationFrames = 0
      this.neutralGaze = null
      this.gazeCalibrationFrames = 0
      this.gazeSmooth = { x: 0, y: 0 }
      this.lastGazeSeen = 0
      this.poseSource = '顔なし'
    }
    return { ...REST }
  }
}
