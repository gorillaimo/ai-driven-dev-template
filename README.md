# Project Name

このREADMEは、AI駆動開発テンプレートから作成されたプロジェクト用の雛形です。
プロジェクト初期化時に、アプリ名、概要、セットアップ手順、起動方法に合わせて更新してください。

テンプレート本体のREADME相当の説明や使い方は、まず `docs/common/template-guide.md` を参照してください。

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
- `docs/system-context.md`
- `docs/architecture.md`
- 対応するGitHub issue

`docs/system-context.md` は、このテンプレートに最初から含まれる固定ファイルではありません。プロジェクト初期化時に、テンプレートの規約に従ってAIへ作成を依頼するプロジェクト固有の前提ドキュメントです。`docs/architecture.md` は、採用アーキテクチャ、技術スタック、デフォルト構成との差分を記録するドキュメントです。

## AIへの依頼例

```text
issue #123 に着手します。
AGENTS.md、docs/common/development-rules.md、docs/system-context.md、docs/architecture.md、issue本文を読み、
目的、受け入れ条件、影響範囲、不明点、実装前に更新すべきドキュメントを報告してください。
不明点が解消するまで実装しないでください。
```

## ライセンス

MIT License
