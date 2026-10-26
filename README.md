# Project Name

このREADMEは、AI駆動開発テンプレートから作成されたプロジェクト用の雛形です。
プロジェクト初期化時に、アプリ名、概要、セットアップ手順、起動方法に合わせて更新してください。

テンプレート本体のREADME相当の説明や使い方は、まず `docs/common/template-guide.md` を参照してください。

テンプレートの現在version、v1 / v2のrelease方針、移行方法は、`VERSION`、`CHANGELOG.md`、`docs/common/versioning-policy.md`、`docs/common/migration-v1-to-v2.md`を参照してください。ルート`VERSION`はtemplate本体のversionであり、利用先アプリケーションのversionではありません。

## 概要

TBD

## 対象ユーザー

TBD

## 主な機能

- TBD

## 技術スタック

- Frontend: TBD
- Backend: TBD
- Infrastructure: TBD
- Auth / Hosting: TBD

## セットアップ

```bash
TBD
```

## 開発コマンド

```bash
TBD
```

## AI駆動開発の進め方

このプロジェクトでは、GitHub issueを開発の最小単位として扱います。

AIエージェントへ作業を依頼する前に、以下を確認してください。

- `AGENTS.md`
- 利用するAI開発ツール向けの入口ファイル、存在する場合のみ
- `docs/common/development-rules.md`
- `docs/common/operations-manual.md`
- `docs/common/quality-gates.md`
- `docs/system-context.md`
- `docs/architecture.md`
- `docs/prototype.md`、プロトタイプ関連issueの場合
- 対応するGitHub issue

`docs/system-context.md` は、このテンプレートに最初から含まれる固定ファイルではありません。プロジェクト初期化時に、テンプレートの規約に従ってAIへ作成を依頼するプロジェクト固有の前提ドキュメントです。`docs/architecture.md` は、採用アーキテクチャ、技術スタック、デフォルト構成との差分を記録するドキュメントです。`docs/prototype.md` は、プロトタイプを作成する場合に範囲、検証結果、後続issue候補を記録するドキュメントです。

テンプレート全体の開発フロー図は、`docs/common/template-guide.md` を参照してください。

既存プロジェクトを変更前に調べる手順は`docs/common/brownfield-analysis-guide.md`、深度別MD/YAML例は`.ai-workflow/templates/brownfield/v1/`にあります。

受け入れ条件と設計・テスト・検証の対応漏れを検査するlibraryは`tools/workflow-trace/`です。契約は`docs/common/adaptive-workflow-design.md`第7章、利用例は`docs/common/operations-manual.md`を参照してください。

計画・状態・履歴・再開候補の静的検査は`tools/workflow-check/`で提供します。利用手順は`docs/common/operations-manual.md`、契約は`docs/common/adaptive-workflow-design.md`第5.4・6.4節を参照してください。

モジュール式ルールのmetadata・オフライン解決libraryは`tools/workflow-rules/`にあります。適用条件、依存・競合、legacy維持、plan連携は`docs/common/adaptive-workflow-design.md`第8章、利用例は`docs/common/operations-manual.md`を参照してください。

Issue成果物のschema v1とYAML記入例は`.ai-workflow/schemas/issue/v1/`、`.ai-workflow/templates/issue/v1/`にあります。項目定義は`docs/common/adaptive-workflow-design.md`、利用・検証手順は`docs/common/operations-manual.md`、互換性とfallbackは`docs/common/versioning-policy.md`を参照してください。

## AIへの依頼例

```text
issue #123 に着手します。
AGENTS.md、docs/common/development-rules.md、docs/system-context.md、docs/architecture.md、docs/prototype.md、issue本文を読み、
目的、受け入れ条件、影響範囲、不明点、実装前に更新すべきドキュメントを報告してください。
不明点が解消するまで実装しないでください。
```

## ライセンス

MIT License
