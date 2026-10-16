VTuLog LIVE iOS — 表情追跡自動開始・統合版

丸ごと差し替えるファイル（すべて src/ 内）:
  src/App.tsx
  src/FaceTracking.tsx
  src/useLive2D.ts

実装内容:
- Live2Dモデルと背面カメラが準備できると表情追跡を自動開始（開始ボタンなし）
- 前後カメラ同時使用: ネイティブMultiCamを継続利用
- MediaPipeによる口の開閉・笑顔・左右のまぶたをLive2Dへ反映
- VTuLog-iOS成功版のbeforeModelUpdate処理を移植（100msごとの書き込み制限なし）
- pixiAppRef公開修正を含む
- 配信先・音声・WHIP/WebRTC・プライバシーモードは既存処理を維持

導入:
GitHub miyuki-design/VTuLog-LIVE-iOS の src/ の同名3ファイルをアップロードしてコミット。
GitHub ActionsでiOSビルドし、実機でアバター表示→カメラ→口・笑顔・まばたきを確認。

注意:
構文チェック通過（3ファイル）。iPhone実機・フルプロジェクトビルドは未検証。
起動時のインターネット接続が必要（MediaPipe WASM/モデル）。
最初は公開配信せず、プレビューでテストしてください。
問題があったら直前に動いていたコミットへ戻せます。
