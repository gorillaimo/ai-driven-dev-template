# Changelog

AI Driven Development Templateの利用者へ影響する変更を記録する。

形式は[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)を参考にし、template release versionは[Semantic Versioning](https://semver.org/)に従う。成果物の`schema_version`、rule version、prompt versionはtemplate release versionとは独立して管理する。

## [Unreleased] - v2 development line

### Added

- 認証済み依頼・上限付き台帳・モデル仲介・固定Codex CLI/Docker adapterを持つ隔離Runnerの開発実装と、模擬応答による境界試験を追加。実provider・書込みvolume quota・単一/2Issueの実AI試行・production採用は未完了で、production起動は拒否する。P4の読戻し専用revalidate APIを追加し、既存v1契約と手動運用を維持。

### Security

- 管理ツール6か所の間接依存fast-uriを3.1.8から3.1.9へ更新し、URI解析・正規化に関する4つの既知問題を修正。各ツールが実際に使用する依存を対象に、安全な文字列入力による回帰テストを追加。

### Added

- Project v2の明示移行・純粋batch plannerと単一LinuxホストのPython/SQLite排他台帳を追加。共有領域・変更パス・実行枠/claim枠・世代・停止/復旧を検査し、P3署名/限定GitHub仲介と接続。合成例、読み取り専用CLI、導入/復旧文書、実並行プロセス/COMMIT前後の強制終了試験をNode22/24のCIへ接続。Project v1と既存推薦は維持。実AI起動・隔離・会話からの自律継続とstable Releaseは含まない。

- GitHub限定実証用のcontroller・固定manifestと手動Actions入口の接続を追加。専用stepでApp鍵をrepo外へ保存し、発行/失効を含むAPI予算、mutation前の実読戻し、公開可能な結果JSON、失効/cleanup不明での停止を検査。合成issuerと実GitHubの評価を分け、本番の自律運用は有効化しない。

- GitHub全量snapshot、Ed25519依頼/承認の照合、最小権限App transport、有限操作broker、repo外の永続journalと応答不明の読戻し、P1 event投影をgithub/v1として追加。合成テストをWorkflow Validationへ接続し、人間とAIの接続準備を分けた手順と限定実証入口を追加。実証環境の採用、会話認証・worker起動・複数Issue予約は別途確認。

- アプリ/テンプレート/実行環境を分けるsecurity/v1、固定Gitleaks/OSV-Scanner/Semgrep CE/Trivy adapterと隔離実行、アプリCI→P1の検証記録接続、合成例・負のテスト、独立したread-only Security Validationを追加。secret/原文を公開せず、未実行・古いDB・故障・期限切れ例外を成功にしない。実Agent Runner/自動修正/実host・LLMへの検査は有効化しない。

- execution/v1の検証・別AIレビュー・セキュリティ/統合結果・実行条件・報告/eventの記録形式、合成YAML例、読み取り専用の整合checkerと明示path loaderを追加。対象commit・改訂・鮮度・指摘の再確認を検査し、Node22/24の既存CIへ専用テストを接続。実scanner/AI起動や自律実行の有効化は含まない。設計書・作業経緯・詳細記録の役割を明記。

- 継続依頼を起点にAIが担当Issueを選んで自律的に進め、人間へ報告する追加設計を承認し、後続実装Issue #46〜#52を整理。検証・別AIレビュー・修正反復、セキュリティ検査、統合検証、停止/復旧と段階実装を記載。夜間実行・朝の確認は利用例であり、既存規約・コード・schema・CI・VERSIONの変更や新機構の有効化は含まない。
- テンプレートの特徴と利点を、GitHubでの記録共有、AIへの指示負担の軽減、段階的な導入、分担・引継ぎ、人間レビュー前のAIによる検証・修正・再検証、検証根拠、ツール・開発言語への対応として整理。現在の運用と、未提供の別AIレビューの標準工程管理・複数Issue自動並行実行を区別。
- テンプレートガイドに役割・情報の受け渡しと開発フローのグラフ図を追加し、人間・AI・検査コード・GitHub Actionsの役割、アプリ自身のテストとの違いを明記。Mermaid原本とSVGを同梱。
- 具体的な作業の指示と、次に行う作業の判断をAIに任せる依頼の両方に対応するv2運用マニュアルへ刷新し、初回プロンプトの掲載先をセットアップへ統一。AIによるIssue発行・文書準備と、人間が判断する点を明確化。
- 初期設定・詳しい依頼例・検査ツール・担当調整の詳細手順を別資料へ整理。担当調整は、必要な場面と人間が決めることを先に案内し、開発体制を確認するタイミングも明記。各案内の日本語表現を校正。
- v2試用前の実装/Release条件の確認表と、隔離した導入・v1段階移行・手動fallbackの合成例を追加。推薦/Project Goldenの提供状況と、全回帰7package/Golden最小5packageの案内を整合。実案件への採用承認とRelease判断は別途行う。

- 既存GoldenハーネスへのProject用4adapterと25固定合成case、共通原本/重要値/禁止結果・非変更/オフラインの統合テスト、既存CI接続の契約確認と導入/限界/fallback文書。既存12caseと合わせ37caseを検証し、実排他・Dispatcher障害・Releaseの保証とは区別する。

- 確認済み台帳/集約元入力/人間・AI依頼を既存checkerで再検査し、本人の次作業1件またはCoordinator向け候補を決定的に返す読み取り専用推薦library、独立context/result v1、安全loader、合成例・専用テストと最小CI接続。待機/不明/競合は停止し、担当・claim・工程を自動実行しない。

- 明示GitHub確認snapshotとIssue checker元入力を読み取り専用集約するlibrary、context/checkpoint/result schema v1、安全な明示path loader、event prefix照合、不整合検出・保守的feature状態、合成例と専用テスト・最小CI接続。実GitHub取得・自動修復・次Issue推薦は行わない。

- Issues-onlyの手動Coordinator運用手順、担当割当・claim・進捗・解除・交代・不整合照合の6種類のMarkdownコメント様式、正常/復旧の机上検証例。自動操作・原子的排他・自動stale解放は提供しない。

- 指定人間のmember・ownership・capacityを確認snapshotから検査するオフラインlibrary、独立context/result schema v1、明示path loader、合成例と専用テスト・最小CI接続。実認証・権限付与・担当/claim操作は行わない。

- feature依存DAG・共有領域の保守的なwave・計画改訂を検査するオフラインlibrary、明示path loader、独立context/result schema v1、テストと最小CI接続。割当・claim操作は行わない。

- Project設定・静的delivery plan・人間のteam台帳のschema v1、Issues-only/manualの合成YAML記入例、既存共通定義を再利用するオフライン形式テストと最小CI接続。

- Node.js 22/24でテンプレートの静的テスト・Golden Testを自動実行するread-only GitHub Actionsと、保存Issue成果物の形式・参照検査、CI契約テスト。

- ワークフローのオフラインGolden Testハーネス、必須11観点の固定合成fixture、期待・禁止結果の比較、入力境界と非実行・非変更のテスト。

- Brownfield解析の読み取り専用ガイド、Low/Medium/HighのMD/YAML記入例、同梱例のオフライン適合テスト。

- フェーズ境界の追跡性checker、正本AC/変更台帳、型付き対応経路、参照確認、期限付き抑制、追加schemaとオフラインテスト。

- 適応的計画・状態遷移・履歴改訂・再開候補を検査するオフラインlibrary、context/result/state拡張schema v1、合成fixtureと回帰テスト。

- モジュール式ルールのmetadata/context/resolution schema v1、legacy always-on参照、オフライン解決・plan v1投影library、条件・依存・競合・循環・ファイル境界の回帰テスト。

- Issue成果物の共通定義とplan/state/traceability/BrownfieldのJSON Schema v1、YAMLテンプレート、合成fixtureのオフライン形式テスト。
- Issue内部の適応的実行計画、状態管理と再開、追跡性検査、モジュール式ルール、Brownfield解析、Golden Testの設計。
- 複数feature、Issue、開発者、AIエージェントを対象とするproject orchestration、依存DAG、team、claim、手動Coordinatorの設計。
- v1 / v2のrelease policy、`VERSION`、v1からv2へのmigration guide。

### Important

- `VERSION`は`2.0.0-0.dev.0`だが、v2機構は設計・開発中であり、`v2.0.0`stable Releaseは未公開。
- schema v1、template、モジュール式ルール解決libraryは利用可能。計画・状態・再開候補の静的checkerも利用可能。追跡性checkerとBrownfield手順・深度別テンプレートも利用可能。オフラインGolden Testも利用可能。Issue内部ワークフローのGitHub Actions統合も利用可能であり、運用は従来のIssue契約と人間承認を維持する。
- GitHub Projects、中央Dispatcher、外部Agent Runnerはv2.0.0の必須条件ではなく、運用実績に応じたopt-in候補。

## [1.0.0] - 2026-08-07

### Added

- フェーズ境界の追跡性checker、正本AC/変更台帳、型付き対応経路、参照確認、期限付き抑制、追加schemaとオフラインテスト。

- 適応的計画・状態遷移・履歴改訂・再開候補を検査するオフラインlibrary、context/result/state拡張schema v1、合成fixtureと回帰テスト。

- モジュール式ルールのmetadata/context/resolution schema v1、legacy always-on参照、オフライン解決・plan v1投影library、条件・依存・競合・循環・ファイル境界の回帰テスト。

- GitHub Issueを開発の最小単位とするIssue First運用。
- assignee、`ready-for-ai`、着手コメント、branch、PRによる人間とAIの責務境界。
- 要件、設計、API、テスト、実装をリポジトリで管理するEverything as Code運用。
- 変更リスク分類、Quality Gates、TDD、Architecture、Prototype、Brownfield事前調査の運用規約。
- Issue契約とPRリンクを確認するGitHub Actions。

### Release boundary

- Tag: `v1.0.0`
- Commit: `f343151ef62cdc1d5ec3fe0cb2d3cfea7d4a0921`
- 位置付け: Issue #8でv2向けadaptive workflow設計を追加する直前の履歴基準。

[Unreleased]: https://github.com/gorillaimo/ai-driven-dev-template/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gorillaimo/ai-driven-dev-template/releases/tag/v1.0.0
