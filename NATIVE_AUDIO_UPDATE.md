# VTuLog LIVE — iOS Native Audio Update (2026-10-23)

## 実装

AVAudioSessionで内蔵マイク優先・スピーカー出力を指定。WHIP/WebRTCにはWebKitのMediaStream音声トラックをそのまま渡します。受信側は再生用の音声経路を選びます。

- iOSネイティブプラグイン: `NativeAudioPlugin.swift`（AVFoundation / AVAudioSession、VTuRECはAVAudioEngineのPCM入力も使用）
- JS側接続: `src/nativeAudio.ts`
- TestFlight配布ワークフロー: `.github/workflows/testflight.yml` にプラグインの登録・読み込みを追加
- VTuLog系は `.github/workflows/build-ios.yml` にも同じブリッジ登録を追加
- 選択は録音時 `playAndRecord` + `defaultToSpeaker`、再生時 `playback`。Bluetooth HFPは使用しない。iPhone内蔵マイク優先、有線イヤホンを接続しているときは出力をイヤホンへ。

## TestFlight確認

1. ZIPの内容をGitHubリポジトリに反映（同名ファイルを置換、新規ファイルを追加）。
2. GitHub Actionsの TestFlight ワークフローを手動実行。前のIPAの上書きではなく新ビルドとしてアップロードされます。
3. iPhoneで更新してカメラ/マイクを許可し、内蔵マイクで録音・再生。VTuLog LIVEはWHIP配信とマイクON/OFF、VTuRECは録音中波形、伴奏・メトロノーム、WAV、原音/補正後を確認。
4. 有線イヤホンなし/ありの両方で出力先と音量を確認。ネイティブ音声経路はSafariのWeb Inspectorコンソールに `iPhone recording route` / `iPhone playback route` と記録されます。

## 検証上の制約

- 同梱ソースの静的解析・TypeScript構文チェックとGitHub Actions YAML検査は実施済み。
- この環境ではmacOS/XcodeおよびiPhone実機がなく、iOS Swiftコンパイル・実機音声動作・TestFlightアップロードは未実施です。
- WebKitが録音開始時にiOSの共有AVAudioSessionを再設定する可能性があるため、VTuLog系はMediaStream確保の前後にルーティングを再指定しています。実機での音途切れ・音量・出力先の確認が必要です。
