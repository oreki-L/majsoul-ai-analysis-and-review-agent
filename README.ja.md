# Majsoul Agent

**一手ごとの選択を理解し、同じ判断について続けて質問できる。**

現在のバージョン：**0.14.0**

[简体中文](README.md) | [English](README.en.md) | **日本語**

雀魂ブラウザ版向けの AI 分析アシスタントです。自分の LLM API を接続し、推奨打牌・候補・押し引きの根拠を見てから、「別の牌を切らない理由は？」「ここでは速度を落とすべき？」と質問できます。判断ごとに局面と議論を固定するため、新しい助言が来ても元の疑問に戻れます。

[**v0.14.0 をダウンロード**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0) · [使い始める](#使い始める) · [ローカルモデル管理](docs/MODEL_MANAGER.md)

![人工局面と模擬モデル応答を使ったフローティング分析カード](docs/images/agent-floating-preview.png)

## 具体的な局面から学ぶ

| やりたいこと | アシスタントの機能 |
| --- | --- |
| 今の選択を理解する | 推奨・候補と解説に、ローカルのシャンテン数・受け入れ・相手別の危険根拠を組み合わせる |
| 同じ判断を続けて質問する | 当時の手牌・卓上情報・元の助言を固定し、個別の議論を保存。ページ更新後も復元できる |
| 前の巡目に戻る | 記録済みの判断を開いて質問を続ける。新しいリアルタイム局面は混ぜない |
| エンジンに先に判断させる | 任意のローカルエンジンが検証済み動作を返し、LLM が解説。解説だけの再試行も可能 |
| モデルを呼ばずに記録する | 独立 Collector で収集・表示・精算履歴・エクスポート |

**通常の LLM 機能は単独で動作し、Mortal・Python・ネイティブツールキットのダウンロードは不要です。** ブラウザ拡張が直接データを収集するため、CDP・リモートデバッグ・システムプロキシの設定は不要です。モデル呼び出しと自動分析は既定で無効。API がなくてもローカル計算を利用できます。自動打牌は行いません。

## 使い始める

1. [完全版 Agent](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip) をダウンロードして展開します。`edge://extensions` または `chrome://extensions` で開発者モードを有効にし、`manifest.json` を直接含むフォルダーを読み込みます。
2. `https://game.maj-soul.com/` を更新し、ゲーム接続前に拡張を読み込んでから対局に入ります。分析カードの分析設定からモデル設定を開きます。
3. tools に対応する **OpenAI Chat Completions 互換エンドポイント**・モデル ID・自分の API Key を入力します。モデル分析を有効にして保存し、接続先への権限を許可します。例：`https://api.openai.com/v1/chat/completions`。
4. 対局パネルで自分の座席と情報利用の許可を確認し、モデル呼び出しを有効にして現在の局面を手動分析します。必要なら自動分析も別途有効にします。助言に追加質問を送ると、その判断の議論を保持できます。

クラウド API・互換ゲートウェイ・ローカルの Chat Completions サービスを自分で選べます。Magpie と CC Switch は任意の接続先です。設定・思考パラメーター・費用・接続診断は [モデル設定](docs/MODEL_CONFIGURATION.md) を参照してください。呼び出しは課金される場合があり、入力は設定したサービスへ送信されます。

現在対応するゲームドメインは `game.maj-soul.com` のみで、拡張の UI は簡体字中国語です。他地域のドメイン・Firefox・Safari・Steam デスクトップ版は未対応です。日本語 README は日本サーバー対応を意味しません。同じゲームページでは Agent と Collector のどちらか一方だけを有効にしてください。

## ダウンロード

| パッケージ | 用途 |
| --- | --- |
| [完全版 Agent · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip) | 分析・追加質問・手牌ヒント・モデル設定。収集機能を含む |
| [独立 Collector · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-collector-0.14.0.zip) | 収集・表示・履歴・エクスポートのみ。モデルコードとモデル接続先の権限を含まない |
| [ローカルモデル管理 · Windows x64 · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-model-manager-windows-x64-0.14.0.zip) | ローカル麻雀エンジンを使う場合のみ。通常の LLM 機能には不要 |
| [ソース · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-source-0.14.0.zip) | 開発・検査・ビルド・オフライン検討 |

[リリースと SHA-256 検査ファイル](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0)。どちらの拡張パッケージにも重み・Python・ネイティブモデルライブラリは含まれません。Collector と Agent のローカル保存領域は別で、自動移行しません。

## v0.14.0：必要なローカルモデルだけをインストール

任意のローカルエンジンに専用管理ページを追加しました。必要なモデルだけをインストールし、明示的に起動・停止できます。インストール済みモデルを残して切り替えたり、不要な重みを削除したりできます。**モデルがゼロでも利用可能です。インストールだけでは推論を開始せず、実行するモデルは一度に一つです。** インストール済みモデルは一つの操作で切り替えて起動できます。

| モデル | 今回の範囲 |
| --- | --- |
| Akagi v2 の弱い Mortal サンプル | 従来の導入・回帰確認用経路を維持 |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | 実験的なコミュニティ Mortal v4、四人半荘。作者は段位戦での使用を推奨していない |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | 実験的なコミュニティ Mortal v4。保守的に四人半荘へ限定 |

ローカルエンジンを使う場合は管理ツールキットを別途取得し、Node.js 22.19+ を用意して、同梱の `start.cmd` を実行します。ターミナルに表示されたローカル URL を開き、管理 Token を入力してモデルをインストールし、明示的に起動します。表示される分析エンドポイントと**分析 Token** を、拡張の対応する設定に保存してください。管理 Token と分析 Token は別のものです。[詳しい手順](docs/MODEL_MANAGER.md)

既定のツールキットには重みや完全な Python 環境を含みません。インストールを押した後に、選んだ重みと必要な実行環境を準備します。VoidShine に Akagi は不要で、二つの v4 モデルは検証済み CPU 環境を共有します。拡張の設定を切り替えると分析は無効になり、インストール済み資産は残ります。拡張がネイティブプログラムを直接起動したり、自動起動を設定したりすることはありません。

ローカルエンジン単独の動作に加えて、「ローカル Mortal 判断 + LLM 自動解説」を選べます。検証済みの動作を先に表示し、LLM は動作を変えずに解説を追加します。追加質問は固定局面を使い、エンジンを再実行しません。二つの v4 モデルは現在、**分析のたびに四人半荘であることを手動確認**する必要があり、自動分析は未対応です。[エンジンと解説の設定](docs/MJAI.md) · [v4 実行ガイド](docs/MORTAL_V4.md)

## データと検証範囲

許可した入力は自分の手牌・公開卓上情報・取得済みの局履歴です。相手の非公開手牌・アカウント認証情報・未来のイベントは分析サービスへ送りません。API Key・議論・利用量は拡張のローカル保存領域に保持します。議論には容量上限があり、クラウド同期や永久保存は保証しません。モデル呼び出しを無効にするとローカル計算のみを行います。[セキュリティと権限](SECURITY.md) · [セッションと利用量](docs/AGENT_SESSIONS.md)

リアルタイム通信の完全な対応・再接続からの復旧・実戦での助言品質は引き続き未検証です。コミュニティ v4 は固定重みの厳密な読み込み、四席の人工局面、合成 HTTP→Agent リクエスト、主要動作の比較を検証しています。これは実戦一局全体の互換性や雀力の証明ではなく、Mortal v4 アーキテクチャも公式 Mortal 4.1 を意味しません。[検証全体](VALIDATION.md) · [v4 の根拠](docs/MORTAL_V4_VALIDATION.md)

過去の LLM の45判断点による事実品質評価と、39判断点の費用・MAKA 比較は [事実強化の検証](docs/XF_VALIDATION.md) と [モデル実験](docs/MODEL_BENCHMARK.md) に残しています。以前の実験条件であり、v0.14.0 や新しいコミュニティモデルの効果・速度・費用を保証しません。参考の第一候補との一致率は正解率や勝率ではありません。

## 開発とドキュメント

開発には Node.js 22.19+ が必要です。拡張 ZIP を読み込むだけなら不要です。

```sh
npm ci
npm run check
npm test
npm run build
```

Agent は Manifest V3 向けに適応した Pi Agent ランタイムを使い、Collector は独立したままです。収集層と分析層は標準データ契約で接続します。実装・オフライン検討・任意の記憶学習・NAGA エクスポート手順はドキュメントを参照してください。

[ドキュメント](docs/README.md) · [アーキテクチャ](ARCHITECTURE.md) · [モジュール分離](docs/DECOUPLING.md) · [貢献](CONTRIBUTING.md) · [変更履歴](CHANGELOG.md) · [参考資料](docs/REFERENCES.md)

補足ドキュメントは現在、簡体字中国語です。プロジェクトのコードと37枚のオリジナル SVG 牌画像は [MIT License](LICENSE) で提供します。任意のモデル・ネイティブコンポーネント・上流コードにはそれぞれのライセンスが適用され、本プロジェクトの MIT 宣言では置き換えられません。[第三者への告知](THIRD_PARTY_NOTICES.md) · [ライセンスの出典](licenses/SOURCES.md)
