VTuLog LIVE iOS — ブラックアウト診断版（MediaPipeのみ）

GitHub VTuLog-LIVE-iOS の src フォルダへ、このZIP内の
src/App.tsx と src/FaceTracking.tsx を丸ごと差し替えてコミット。
GitHub Actions でビルドし、iPhoneで起動してください。

1. Live2Dモデルを読み込む（この段階ではカメラ切替は発生しない）
2. 「MediaPipeだけ診断する」を押す
3. 「診断 1/2」「診断 2/2」「✅ 初期化成功」が表示されるか確認
4. 表示中・表示後にブラックアウトするか確認

この診断版は表情追跡・前面カメラ・MultiCamを起動しません。
背面カメラ・配信API・Swiftファイルは変更していません。
初期化だけで落ちるかを切り分けるための一時版です。
※ 安全のため診断時はGO LIVEせず、プレビュー画面で確認してください。
