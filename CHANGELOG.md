# Changelog

AI Driven Development Templateの利用者へ影響する変更を記録する。

形式は[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)を参考にし、template release versionは[Semantic Versioning](https://semver.org/)に従う。成果物の`schema_version`、rule version、prompt versionはtemplate release versionとは独立して管理する。

## [Unreleased] - v2 development line

### Added

- フェーズ境界の追跡性checker、正本AC/変更台帳、型付き対応経路、参照確認、期限付き抑制、追加schemaとオフラインテスト。

- 適応的計画・状態遷移・履歴改訂・再開候補を検査するオフラインlibrary、context/result/state拡張schema v1、合成fixtureと回帰テスト。

- モジュール式ルールのmetadata/context/resolution schema v1、legacy always-on参照、オフライン解決・plan v1投影library、条件・依存・競合・循環・ファイル境界の回帰テスト。

- Issue成果物の共通定義とplan/state/traceability/BrownfieldのJSON Schema v1、YAMLテンプレート、合成fixtureのオフライン形式テスト。
- Issue内部の適応的実行計画、状態管理と再開、追跡性検査、モジュール式ルール、Brownfield解析、Golden Testの設計。
- 複数feature、Issue、開発者、AIエージェントを対象とするproject orchestration、依存DAG、team、claim、手動Coordinatorの設計。
- v1 / v2のrelease policy、`VERSION`、v1からv2へのmigration guide。

### Important

- `VERSION`は`2.0.0-0.dev.0`だが、v2機構は設計・開発中であり、`v2.0.0`stable Releaseは未公開。
- schema v1、template、モジュール式ルール解決libraryは利用可能。計画・状態・再開候補の静的checkerも利用可能。追跡性checkerも利用可能。Golden Test、GitHub Actions統合は後続実装であり、運用は従来のIssue契約と人間承認を維持する。
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
