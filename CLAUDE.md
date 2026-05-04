# CLAUDE.md

このリポジトリでClaude Codeを使う場合は、まず `AGENTS.md` を読み、詳細規約として `docs/common/development-rules.md` を参照してください。

このファイルはClaude Code向けの入口です。プロジェクト固有のAI運用ルールは `AGENTS.md` に集約し、Claude Code、Codex、その他のAI開発ツールで同じ作業契約を共有できるようにします。

## 必ず参照するファイル

- `AGENTS.md`: AIエージェント共通の入口
- `docs/common/development-rules.md`: AI向けの開発規約
- `docs/common/operations-manual.md`: 人間向けの運用手順
- `docs/system-context.md`: アプリ全体の前提、存在する場合は必ず参照
- GitHub issue本文: 対応issueがある場合は必ず参照

## Claude Code利用時の補足

- issue本文と `docs/` 配下のドキュメントを作業契約として扱ってください。
- `ready-for-ai` ラベルがないissueは、実装前に不足情報を確認してください。
- assignee未設定のissueには着手しないでください。
- 複数エージェントで作業する場合は、primary agentまたは統合担当者、担当範囲、変更予定ファイルを確認してから着手してください。
- ツール権限、slash command、MCP連携を追加する場合は、プロジェクトのセキュリティ方針に合わせて設定し、必要に応じて `docs/common/operations-manual.md` を更新してください。
