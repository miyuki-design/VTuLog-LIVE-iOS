import Foundation
import AVFoundation
import UIKit
import Capacitor

// The WebView relinquishes its rear camera before this plug-in starts.
// Both cameras must belong to a single AVCaptureMultiCamSession.
@objc(MultiCamPlugin)
public class MultiCamPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate {
    public let identifier = "MultiCamPlugin"
    public let jsName = "MultiCam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "vtulog.multicam.capture")
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var session: AVCaptureMultiCamSession?
    private var rearOutput: AVCaptureVideoDataOutput?
    private var frontOutput: AVCaptureVideoDataOutput?
    private var lastSent: [String: CFTimeInterval] = [:]
    private var currentGeneration = 0

    @objc public func start(_ call: CAPPluginCall) {
        queue.async {
            if self.session != nil { call.resolve(); return }
            guard AVCaptureMultiCamSession.isMultiCamSupported else {
                call.reject("このiPhoneではAVCaptureMultiCamSessionを利用できません")
                return
            }
            let permission = AVCaptureDevice.authorizationStatus(for: .video)
            guard permission == .authorized else {
                call.reject("カメラの許可がありません。VTuLogのカメラ権限を確認してください")
                return
            }
            guard let rear = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
                call.reject("前面または背面カメラを見つけられません")
                return
            }
            let session = AVCaptureMultiCamSession()
            session.beginConfiguration()
            do {
                let rearInput = try AVCaptureDeviceInput(device: rear)
                let frontInput = try AVCaptureDeviceInput(device: front)
                guard session.canAddInput(rearInput), session.canAddInput(frontInput) else {
                    throw NSError(domain: "MultiCam", code: 1, userInfo: [NSLocalizedDescriptionKey: "両カメラの入力を追加できません"])
                }
                session.addInputWithNoConnections(rearInput)
                session.addInputWithNoConnections(frontInput)

                let backOutput = AVCaptureVideoDataOutput()
                let selfieOutput = AVCaptureVideoDataOutput()
                for output in [backOutput, selfieOutput] {
                    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)]
                    output.alwaysDiscardsLateVideoFrames = true
                    guard session.canAddOutput(output) else {
                        throw NSError(domain: "MultiCam", code: 2, userInfo: [NSLocalizedDescriptionKey: "映像出力を追加できません"])
                    }
                    session.addOutputWithNoConnections(output)
                    output.setSampleBufferDelegate(self, queue: self.queue)
                }
                guard let rearPort = rearInput.ports(for: .video, sourceDeviceType: rear.deviceType, sourceDevicePosition: .back).first,
                      let frontPort = frontInput.ports(for: .video, sourceDeviceType: front.deviceType, sourceDevicePosition: .front).first else {
                    throw NSError(domain: "MultiCam", code: 3, userInfo: [NSLocalizedDescriptionKey: "カメラの接続口が見つかりません"])
                }
                let rearConnection = AVCaptureConnection(inputPorts: [rearPort], output: backOutput)
                let frontConnection = AVCaptureConnection(inputPorts: [frontPort], output: selfieOutput)
                guard session.canAddConnection(rearConnection), session.canAddConnection(frontConnection) else {
                    throw NSError(domain: "MultiCam", code: 4, userInfo: [NSLocalizedDescriptionKey: "前後カメラの同時接続ができません"])
                }
                session.addConnection(rearConnection)
                session.addConnection(frontConnection)
                // videoRotationAngle was introduced in iOS 17. Guard it because the
                // Capacitor project may target an older minimum iOS version.
                if #available(iOS 17.0, *) {
                    if rearConnection.isVideoRotationAngleSupported(90) {
                        rearConnection.videoRotationAngle = 90
                    }
                    if frontConnection.isVideoRotationAngleSupported(90) {
                        frontConnection.videoRotationAngle = 90
                    }
                } else {
                    if rearConnection.isVideoOrientationSupported {
                        rearConnection.videoOrientation = .portrait
                    }
                    if frontConnection.isVideoOrientationSupported {
                        frontConnection.videoOrientation = .portrait
                    }
                }
                self.rearOutput = backOutput
                self.frontOutput = selfieOutput
                session.commitConfiguration()
                self.currentGeneration += 1
                self.lastSent.removeAll()
                self.session = session
                session.startRunning()
                if session.isRunning {
                    call.resolve()
                } else {
                    self.stopCapture()
                    call.reject("カメラセッションの起動に失敗しました")
                }
            } catch {
                session.commitConfiguration()
                self.stopCapture()
                call.reject("前後カメラの準備に失敗: \(error.localizedDescription)")
            }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        queue.async { self.stopCapture(); call.resolve() }
    }

    private func stopCapture() {
        currentGeneration += 1
        let old = session
        session = nil
        rearOutput = nil
        frontOutput = nil
        old?.stopRunning()
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard session != nil else { return }
        let camera: String
        let interval: CFTimeInterval
        let maxSide: CGFloat
        if output === rearOutput {
            camera = "rear"; interval = 1.0 / 12.0; maxSide = 960
        } else if output === frontOutput {
            camera = "front"; interval = 1.0 / 12.0; maxSide = 320
        } else { return }
        let now = CACurrentMediaTime()
        if now - (lastSent[camera] ?? 0) < interval { return }
        lastSent[camera] = now
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let source = CIImage(cvPixelBuffer: buffer)
        let rect = source.extent
        let scale = min(1, maxSide / max(rect.width, rect.height))
        let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = ciContext.createCGImage(scaled, from: scaled.extent),
              let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: camera == "rear" ? 0.72 : 0.65) else { return }
        let payload = jpeg.base64EncodedString()
        let generation = currentGeneration
        DispatchQueue.main.async {
            guard generation == self.currentGeneration, self.session != nil else { return }
            self.notifyListeners("frame", data: ["camera": camera, "jpeg": payload])
        }
    }
}

// A custom bridge controller registers the native plug-in without needing a separate pod.
class VTuLogBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MultiCamPlugin())
    }
}
