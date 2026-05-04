# AGENTS.md

このリポジトリで作業するAIエージェントは、最初にこのファイルを読み、詳細規約として `docs/common/development-rules.md` を必ず参照すること。

## 最重要ルール

- issueを開発の最小単位として扱う。
- GitHub issue本文、関連ドキュメント、受け入れ条件を作業契約とする。
- issue外の改善、リファクタリング、仕様追加を勝手に実装しない。
- 不明点は推測で埋めず、確認事項としてユーザーに提示する。
- 実装前に要件、設計、API定義、テスト観点を確認する。
- assignee未設定のissueには着手しない。
- issue確認時にマルチエージェント化が有効か判断し、有効な場合は分割案を提示して人間の承認を得る。
- 複数エージェントで作業する場合は、primary agentまたは統合担当者、担当範囲、変更予定ファイルを確認してから着手する。
- 実装は最小差分で行い、作業完了時に検証結果と未検証事項を報告する。

## 必ず読むドキュメント

- `docs/common/development-rules.md`: AI向けの開発規約
- `docs/common/operations-manual.md`: 人間向けの運用手順
- `docs/system-context.md`: アプリ全体の前提、存在する場合は必ず参照
- GitHub issue本文: 対応issueがある場合は必ず参照

## 作業開始時の確認

対応issueがある場合、AIは実装前に以下を要約すること。

- issueの目的
- 受け入れ条件
- スコープと非スコープ
- 影響範囲
- 参照したドキュメント
- 不明点
- 実装前に更新すべきドキュメント

`ready-for-ai` ラベルがないissueは、実装前に不足情報を確認すること。
assigneeはissueの責任を持つ人間のGitHubアカウントとして扱うこと。assigneeが未設定のissueは、実装前に担当者の設定を確認すること。
複数エージェント化が有効な場合は、各エージェントの担当範囲、変更可能ファイル、統合担当者、単一エージェントで進める場合と比べた利点とリスクを提示し、人間の承認を得ること。

## 実装前の原則

- STEP 0: `docs/system-context.md` を確認する。
- STEP 1: `docs/requirements/[issue-number]-[feature].md` を作成または更新する。
- STEP 2: `docs/design/[issue-number]-[feature].md` を作成または更新する。
- STEP 3: API変更がある場合は `docs/api/openapi.yaml` を更新する。
- STEP 4: 受け入れ条件に対応するテストを先に作成し、その後に実装する。

テンプレート本体の改善issueでは、利用先プロジェクトに不要な履歴ドキュメントを残さないため、原則として `docs/requirements/` や `docs/design/` にissue別ドキュメントを作成しない。issue本文と既存共通ドキュメント更新で要件・設計整理を代替する。

## GitHub運用

- PR本文には対応issueを `Closes #123` の形式で記載する。
- PR本文には受け入れ条件ごとの対応、更新したドキュメント、実行した検証、残課題を記載する。
- 共通定義、API、認証、Infrastructureに影響する変更は、実装前に人間の承認を得る。
