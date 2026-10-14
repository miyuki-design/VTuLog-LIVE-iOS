VTuLog LIVE iOS — MultiCam + Live2D tracking test patch (2026-10-15)

Target repository: miyuki-design/VTuLog-LIVE-iOS, main.
This is a FULL-FILE replacement patch based on the repo snapshot whose src/App.tsx git blob SHA is ef2a99297806d01f5800a304ba900942e6f0b278.

Install these five files preserving paths:
  src/App.tsx
  src/FaceTracking.tsx (new)
  MultiCamPlugin.swift (new, repo root)
  package.json
  .github/workflows/build-ios.yml

Then run the existing Build VTuLog LIVE iOS workflow *as a new run*, not a re-run of an old commit.
The workflow runs pnpm install --no-frozen-lockfile; committed lockfile not required for first test.

Test first BEFORE going live: check native plugin initialization, front camera tracked expression, rear scene orientation, privacy-mode (no scene shown), and live-canvas image.
Only then try a private stream and check audio/video synchronization.

CAUTION: The native bridge's rear frames are compressed JPEGs (about 960px long side at 12fps) and may lower live image quality vs the previous 30fps webcam capture. While facial tracking is active, performance and battery use will change. This test patch does not claim stable multi-hour streaming.
Front-camera frames are only analyzed, never drawn onto the broadcast canvas. However they temporarily exist in JS as image data for MediaPipe.
If modifying the repo after the snapshot, compare files before replacing App.tsx or workflow to avoid overwriting newer edits.
