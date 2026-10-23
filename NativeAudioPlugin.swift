import Foundation
import AVFoundation
import Capacitor

// Native iPhone audio routing + unprocessed PCM microphone input.
// There is ONE shared AVAudioSession for the app (including WKWebView/WebRTC).
// Never create a second microphone capture while a WebRTC MediaStream owns it.
@objc(NativeAudioPlugin)
public final class NativeAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAudioPlugin"
    public let jsName = "NativeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPCM", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPCM", returnType: CAPPluginReturnPromise)
    ]

    private let pcmQueue = DispatchQueue(label: "vtulog.native.audio.pcm", qos: .userInitiated)
    private var engine: AVAudioEngine?
    private var tapInstalled = false

    private func route(_ session: AVAudioSession) -> [String: Any] {
        return [
            "input": session.currentRoute.inputs.map { $0.portType.rawValue },
            "output": session.currentRoute.outputs.map { $0.portType.rawValue },
            "sampleRate": session.sampleRate
        ]
    }

    private func setSession(recording: Bool, studio: Bool = false) throws -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        if recording {
            // defaultToSpeaker avoids the quiet earpiece / telephone route.
            // Wired headphones remain usable for backing track + metronome.
            let mode: AVAudioSession.Mode = studio ? .measurement : .default
            if session.category != .playAndRecord || session.mode != mode ||
                !session.categoryOptions.contains(.defaultToSpeaker) {
                try session.setCategory(.playAndRecord, mode: mode, options: [.defaultToSpeaker])
            }
            try session.setActive(true)
            // Keep iPhone microphone even when a headset has its own mic.
            // Do not enable Bluetooth HFP (it substantially reduces audio quality).
            if let mic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
                try session.setPreferredInput(mic)
            }
        } else {
            // Native playback category uses speaker/headphones and ignores silent switch.
            if session.category != .playback || session.mode != .default {
                try session.setCategory(.playback, mode: .default, options: [])
            }
            try session.setActive(true)
        }
        return route(session)
    }

    @objc public func configure(_ call: CAPPluginCall) {
        do {
            let recording = call.getString("mode") == "record"
            // Never switch to playback while native PCM recording is running.
            if engine != nil && !recording {
                call.reject("録音中に再生モードへ変更できません")
                return
            }
            call.resolve(try setSession(recording: recording, studio: call.getString("profile") == "studio"))
        } catch {
            call.reject("iPhone音声経路の設定に失敗: \(error.localizedDescription)")
        }
    }

    @objc public func getRoute(_ call: CAPPluginCall) {
        call.resolve(route(AVAudioSession.sharedInstance()))
    }

    @objc public func startPCM(_ call: CAPPluginCall) {
        guard engine == nil else { call.reject("録音はすでに開始されています"); return }
        let permission = AVAudioSession.sharedInstance().recordPermission
        switch permission {
        case .granted:
            beginPCM(call)
        case .denied:
            call.reject("マイクが許可されていません。iPhoneの設定で許可してください")
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    if granted { self.beginPCM(call) }
                    else { call.reject("マイクへのアクセスが拒否されました") }
                }
            }
        @unknown default:
            call.reject("マイクの権限を確認できません")
        }
    }

    private func beginPCM(_ call: CAPPluginCall) {
        guard engine == nil else { call.reject("すでに録音中です"); return }
        do {
            _ = try setSession(recording: true, studio: true)
            let newEngine = AVAudioEngine()
            let input = newEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0,
                  format.commonFormat == .pcmFormatFloat32 else {
                call.reject("iPhoneマイクのPCM形式に対応していません")
                return
            }
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                // Copy only. Never touch UIKit / JS from the real-time audio thread.
                guard let self = self, let channel = buffer.floatChannelData?[0] else { return }
                let frames = Int(buffer.frameLength)
                if frames == 0 { return }
                let copy = Data(bytes: channel, count: frames * MemoryLayout<Float>.size)
                self.pcmQueue.async {
                    let base64 = copy.base64EncodedString()
                    DispatchQueue.main.async {
                        self.notifyListeners("pcm", data: ["samples": base64])
                    }
                }
            }
            tapInstalled = true
            engine = newEngine
            do {
                try newEngine.start()
            } catch {
                input.removeTap(onBus: 0)
                tapInstalled = false
                engine = nil
                throw error
            }
            call.resolve(["sampleRate": format.sampleRate])
        } catch {
            call.reject("iPhoneマイクの録音を開始できません: \(error.localizedDescription)")
        }
    }

    @objc public func stopPCM(_ call: CAPPluginCall) {
        guard let active = engine else { call.resolve(); return }
        // Stop production first; then flush the encoding queue and main event queue.
        if tapInstalled {
            active.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        active.stop()
        engine = nil
        pcmQueue.async {
            DispatchQueue.main.async { call.resolve() }
        }
    }

    deinit {
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }
        engine?.stop()
    }
}
