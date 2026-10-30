VTuLog LIVE-iOS：頭・上半身トラッキング追加キット
対象: https://github.com/miyuki-design/VTuLog-LIVE-iOS
作成日: 2026-10-30

【GitHub Actionsで適用する方法（PCの開発環境不要）】
1. GitHubの VTuLog-LIVE-iOS リポジトリを開く。
2. Add file > Create new file を開く。
3. ファイル名を .github/workflows/enable-live2d-head-body.yml にする。
4. 同梱の enable-live2d-head-body.yml の内容を全部コピーして貼り付け、mainにコミットする。
5. リポジトリの Actions タブから「Enable Live2D head and body tracking」を選ぶ。
6. 「Run workflow」を押す。先にソースを変更し、iOS用Webアセットのビルドが成功した場合に限って変更をmainにコミットする。
7. 緑のチェックを確認したら、既存のTestFlight更新ワークフローを実行する。
8. iPhoneで新しいTestFlight版をインストールして、顔を正面に向けて初期位置合わせをした後に頭を動かして試す。

【ローカルで適用する方法（オプション）】
1. GitHubからリポジトリをローカルにcloneする。
2. 同梱の faceMotion.ts を src/faceMotion.ts にコピーする。
3. 同梱の apply-face-motion.mjs をリポジトリ直下に置く。
4. リポジトリ直下で node apply-face-motion.mjs を実行する。
5. pnpm install --no-frozen-lockfile && pnpm run build:ios を実行して動作確認する。
6. src/FaceTracking.tsx、src/faceMotion.ts だけをコミット、pushする。

【変更点】
・顔の3D姿勢（MediaPipe変換行列）から頭の左右、上下、傾きをLive2Dに反映。
・顔の位置と頭の動きから上半身が小さく、少し遅れて追随。
・元の口パク、笑顔、左右の瞬きを維持。
・初回の約8フレームは自動で正面位置を記憶。
・顔を見失った場合は停止せず徐々に基本姿勢に戻す。
・モデルが未対応のLive2Dパラメータはスキップ。
・顔映像を配信や保存に追加しない。既存の前後同時カメラ処理は変更しない。

【制約】
・肩や腕をカメラで独立計測するものではなく、顔から推定した上半身の追随動作です。
・Live2Dモデル側に ParamAngleX/Y/Z と ParamBodyAngleX/Y/Z がない方向は動きません。
・まだ実機確認は行っていません。特に左右・上下の符号はモデルやカメラの向きで調整が必要になる場合があります。
・GoogleのMediaPipe Face Landmarkerを利用しています。
