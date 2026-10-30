# VTuLog LIVE — WebKit audio restore (2026-10-30)

## Audio path
- Microphone input: `navigator.mediaDevices.getUserMedia({ audio: ... })` (WKWebView / WebKit MediaStream).
- Playback: `<video>` (and WebRTC player for LIVE) managed by WebKit.
- NO custom `AVAudioSession.setCategory`/`setPreferredInput`/`setActive` call.
- Retain the native iOS `MultiCamPlugin.swift` for front/rear cameras and Live2D face tracking.
- `NativeAudioPlugin.swift` and `src/nativeAudio.ts` have been removed. Both iOS CI workflows also stop embedding/registering that plugin.
- This is a *WebKit route restoration*, not a rollback of head/body tracking.

## Testing
1. Update GitHub sources (or run the corresponding restore workflow) and run TestFlight build; never delete the installed app if local data is not backed up.
2. On iPhone, permit Microphone and Camera. Test without external audio accessories first.
3. Start a short Twitch or YouTube stream, verify audio at the destination, stop, then repeat once.
4. If streaming still fails, collect WHIP / WebRTC status and any runtime error; audio rollback alone cannot resolve server/network problems.

## Notes
- Requires macOS / Xcode and iPhone to test the full native app. Web-build and static checks do not prove camera/audio or streaming works on-device.
- Uninstalling TestFlight apps can remove stored recordings/settings; update in place.
