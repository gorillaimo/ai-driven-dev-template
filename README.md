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

プロジェクト設定・機能の開発計画・メンバー台帳のschema v1と合成記入例は`.ai-workflow/schemas/project/v1/`と`.ai-workflow/templates/project/v1/`にあります。形式テストの成功は担当・権限・承認の確認ではありません。利用方法は`docs/common/operations-manual.md`を参照してください。

機能の依存関係・共有領域・計画改訂は`tools/workflow-project/`で読み取り専用検査できます。開発順序と待機理由を返します。担当割当や作業開始の操作は行いません。

指定した人間のメンバー・担当領域・権限の確認記録と同時担当数も、同packageのmember検査で確認できます。実GitHubの認証・権限変更・担当確定は人間が行います。

人間が担当割当・着手記録・解除・引き継ぎを行う手順は[手動Coordinator運用](docs/common/manual-coordinator.md)、Issueコメント用の様式は[project-manual/v1](.ai-workflow/templates/project-manual/v1/README.md)にあります。任意導入で、自動割当や自動解放は行いません。

複数Issueの確認snapshotと内部工程は`tools/workflow-project/aggregate.mjs`で読み取り専用集約できます。担当・claim・branch・PR・工程の不整合とfeatureの状態を返します。実GitHub取得や状態変更は行いません。入力例と手順は[運用マニュアル](docs/common/operations-manual.md)を参照してください。

次に確認する1作業は`tools/workflow-project/recommend.mjs`で提案できます。本人の既存作業を優先し、担当がなければCoordinatorへの相談候補を返します。人間が確認した元入力を再検査し、担当・claim・工程を自動実行しません。利用例と停止時の手順は[運用マニュアル](docs/common/operations-manual.md)を参照してください。

PRの作成・更新時にはGitHub Actionsの`Workflow Validation`が、テンプレートの静的テスト・Golden Testと保存Issue YAMLの形式・参照を検査します。開発するアプリ自体のテストは別途用意します。詳しくは`docs/common/operations-manual.md`の「GitHub Actionsでのワークフロー検査」を参照してください。

ワークフロー変更の回帰は`tools/workflow-golden/`のオフラインGolden Testで確認できます。開発対象の言語に関係なく、開発環境のNode.jsで動かします。実行方法と期待見本の更新手順は`docs/common/operations-manual.md`を参照してください。

Projectの計画・担当・集約・推薦も、同じGolden Testの25合成ケースで確認します。既存12と合わせ37ケースです。導入時はworkflow-projectの依存も揃えてください。[固定例と保証範囲](docs/examples/project-golden/README.md)に、停止条件・手動対応と未検証の実操作をまとめています。

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
