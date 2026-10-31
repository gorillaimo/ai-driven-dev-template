# Changelog

AI Driven Development Templateの利用者へ影響する変更を記録する。

形式は[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)を参考にし、template release versionは[Semantic Versioning](https://semver.org/)に従う。成果物の`schema_version`、rule version、prompt versionはtemplate release versionとは独立して管理する。

## [Unreleased] - v2 development line

### Added

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
