# Project Name

このREADMEは、AI駆動開発テンプレートから作成されたプロジェクト用の雛形です。
プロジェクト初期化時に、アプリ名、概要、セットアップ手順、起動方法に合わせて更新してください。

テンプレート本体のREADME相当の説明や使い方は、まず `docs/common/template-guide.md` を参照してください。

テンプレートの現在version、v1 / v2のrelease方針、移行方法は、`VERSION`、`CHANGELOG.md`、`docs/common/versioning-policy.md`、`docs/common/migration-v1-to-v2.md`を参照してください。ルート`VERSION`はtemplate本体のversionであり、利用先アプリケーションのversionではありません。

v2を試す前に、[試用前の確認表](docs/common/v2-adoption-checklist.md)と[運用マニュアルの読む順序](docs/common/operations-manual.md)を参照してください。隔離した導入・移行例、確認済み範囲、残る人間判断をまとめています。現在は開発版です。

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

**目的を伝えたら、普段は「進めてください」で続けます。** AIが規約・Issue・PR・作業記録を確認し、次に必要な作業と人間へ確認する点を判断します。

```text
このリポジトリの開発を進めてください。
目的: ［作りたいもの・改善したいこと］
人間の担当者: ［GitHubアカウント］
AGENTS.mdと関連文書、Issue・PR・作業記録を確認して進めてください。
```

[運用マニュアル](docs/common/operations-manual.md)に、普段の依頼・必要な判断・PRレビュー・中断/再開をまとめています。
初回は[セットアップ](docs/common/operations-setup.md)、既存プロジェクトでは[移行ガイド](docs/common/migration-v1-to-v2.md)をAIと確認してください。

AIは[AGENTS.md](AGENTS.md)と[開発規約](docs/common/development-rules.md)を入口に、Issueと必要な文書を読みます。
プロジェクト固有の前提は`docs/system-context.md`、採用構成は`docs/architecture.md`、プロトタイプの範囲と結果は必要に応じて`docs/prototype.md`に整理します。`docs/system-context.md`は初期化時に作成します。

機構別のコマンド・schema・入力/結果・保証範囲は[検査ツールの利用詳細](docs/common/workflow-tools-guide.md)を参照してください。
Node.jsは開発管理用で、アプリの言語は問いません。GitHub Actionsはテンプレート運用を検査し、アプリ自身のテストは別途用意します。
Projectの計画・担当・集約・推薦は必要な範囲で採用でき、単一Issue運用も継続できます。担当や設計の承認・マージ・Releaseは対象を確認して判断します。

## ライセンス

MIT License
