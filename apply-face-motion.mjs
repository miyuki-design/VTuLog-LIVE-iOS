/**
 * Safe, one-off patch for miyuki-design/VTuLog-LIVE-iOS main.
 * Run from a clean checkout of VTuLog-LIVE-iOS:
 *   node apply-face-motion.mjs
 * A replacement only happens after every known source pattern matches.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(process.cwd(), 'src/FaceTracking.tsx')
const helperPath = resolve(process.cwd(), 'src/faceMotion.ts')
if (!existsSync(sourcePath)) throw new Error('Run this from the VTuLog-LIVE-iOS repository root.')
if (!existsSync(helperPath)) throw new Error('Copy faceMotion.ts into src/ before running this script.')
let code = readFileSync(sourcePath, 'utf8')
if (code.includes("from './faceMotion'")) {
  console.log('Already patched; no changes made.')
  process.exit(0)
}

function replaceOnce(before, after, description) {
  const position = code.indexOf(before)
  if (position === -1) throw new Error(`Aborted; source changed (missing ${description}). No changes were written.`)
  if (code.indexOf(before, position + before.length) !== -1) {
    throw new Error(`Aborted; duplicate source pattern (${description}). No changes were written.`)
  }
  code = code.slice(0, position) + after + code.slice(position + before.length)
}

replaceOnce(
  "import type { PluginListenerHandle } from '@capacitor/core'",
  "import type { PluginListenerHandle } from '@capacitor/core'\nimport { FaceMotionController, REST, type TrackingScores } from './faceMotion'",
  'motion import',
)
replaceOnce(
  "type Scores = { mouth: number; smile: number; leftEye: number; rightEye: number }\nconst DEFAULT: Scores = { mouth: 0, smile: 0, leftEye: 1, rightEye: 1 }",
  "type Scores = TrackingScores\nconst DEFAULT: Scores = REST",
  'scores type',
)
replaceOnce(
  "  const scoresRef = useRef<Scores>({ ...DEFAULT })",
  "  const scoresRef = useRef<Scores>({ ...DEFAULT })\n  const motionRef = useRef(new FaceMotionController())",
  'motion controller',
)
replaceOnce(
  "    scoresRef.current = { ...DEFAULT }\n    frontFrameReadyRef.current = false",
  "    scoresRef.current = { ...DEFAULT }\n    motionRef.current.reset()\n    frontFrameReadyRef.current = false",
  'stop and reset',
)
replaceOnce(
  "    const keys = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen']\n    debugRef.current.parameters = keys.map((k, i) =>\n      `${['口開','口形','左目','右目'][i]}:${params.has(k) ? '有' : '無'}`",
  "    const keys = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen',\n      'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']\n    debugRef.current.parameters = keys.map((k, i) =>\n      `${['口開','口形','左目','右目','頭X','頭Y','頭Z','体X','体Y','体Z'][i]}:${params.has(k) ? '有' : '無'}`",
  'model capability reporting',
)
replaceOnce(
  "        drive('ParamEyeROpen', s.rightEye, 0.55)",
  "        drive('ParamEyeROpen', s.rightEye, 0.55)\n        // Head responds promptly; torso follows a little more slowly.\n        drive('ParamAngleX', s.headX, 0.20)\n        drive('ParamAngleY', s.headY, 0.20)\n        drive('ParamAngleZ', s.headZ, 0.20)\n        drive('ParamBodyAngleX', s.bodyX, 0.10)\n        drive('ParamBodyAngleY', s.bodyY, 0.10)\n        drive('ParamBodyAngleZ', s.bodyZ, 0.10)",
  'head and torso parameters',
)
replaceOnce(
  "        outputFaceBlendshapes: true,",
  "        outputFaceBlendshapes: true,\n        outputFacialTransformationMatrixes: true,",
  'facial transform output',
)
replaceOnce(
  "              const categories = landmarker.detectForVideo(canvas, now).faceBlendshapes?.[0]?.categories",
  "              const result = landmarker.detectForVideo(canvas, now)\n              const categories = result.faceBlendshapes?.[0]?.categories",
  'native frame observation',
)
replaceOnce(
  `                scoresRef.current = {
                  mouth: Math.min(1, score(categories, 'jawOpen') * 1.5),
                  smile: Math.min(1, score(categories, 'mouthSmileLeft') + score(categories, 'mouthSmileRight')),
                  leftEye: 1 - score(categories, 'eyeBlinkLeft'),
                  rightEye: 1 - score(categories, 'eyeBlinkRight'),
                }
                debugRef.current.mouthTarget = scoresRef.current.mouth
              }`,
  `                const motion = motionRef.current.update(result, now)
                if (motion) scoresRef.current = motion
                debugRef.current.mouthTarget = scoresRef.current.mouth
              } else {
                scoresRef.current = motionRef.current.whenMissing(now) ?? scoresRef.current
              }`,
  'native tracking calculation',
)
replaceOnce(
  `            if (categories) {
              scoresRef.current = {
                mouth: Math.max(0, Math.min(1, score(categories, 'jawOpen') * 1.5)),
                smile: Math.max(-1, Math.min(1, (score(categories, 'mouthSmileLeft') + score(categories, 'mouthSmileRight')))),
                leftEye: 1 - score(categories, 'eyeBlinkLeft'),
                rightEye: 1 - score(categories, 'eyeBlinkRight'),
              }
            }`,
  `            if (categories) {
              const motion = motionRef.current.update(result, now)
              if (motion) scoresRef.current = motion
            } else {
              scoresRef.current = motionRef.current.whenMissing(now) ?? scoresRef.current
            }`,
  'browser tracking calculation',
)

// Write only after all patterns matched (no partially patched file).
writeFileSync(sourcePath, code, 'utf8')
console.log('✅ src/FaceTracking.tsx now tracks head XYZ and subtle body XYZ. Existing blink and mouth tracking are retained.')
console.log('✅ src/faceMotion.ts is in place. Commit both files, then build and test on iPhone.')
