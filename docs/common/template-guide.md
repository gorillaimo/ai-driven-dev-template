# AI Driven Development Template

AIエージェントと人間が、GitHub issueを作業契約として共有しながら開発を進めるための、**AI駆動開発向けテンプレート**です。

このテンプレートは、要件定義、設計、API定義、テスト、実装、PR作成までを issue 起点で進めることを前提にしています。

また、要件、設計、API仕様、テスト観点、運用ルールをリポジトリ内のファイルとして管理する **Everything as Code** の考え方に沿っています。AIエージェントは、口頭の指示や暗黙知ではなく、GitHub issue と `docs/` 配下のドキュメントを根拠に作業します。

## 目的

- issueを開発の最小単位として扱う
- AIが推測で実装しないよう、要件・設計・受け入れ条件を明文化する
- 要件、設計、API、テスト、運用ルールを Everything as Code として管理する
- GitHub Issue Form と GitHub Actions で作業契約の不足を検出する
- PRに対応issue、検証結果、残課題を残す
- プロジェクトごとの `AGENTS.md` とツール別入口ファイルからAIエージェントへ規約を伝える

## 含まれるもの

- `README.md`: 利用先プロジェクト用READMEの雛形
- `AGENTS.md`: AIエージェント共通の入口
- `CLAUDE.md`: Claude Code向けの入口
- `.gitattributes`: Git上の改行コードとテキスト判定の基本設定
- `docs/common/development-rules.md`: AI向け開発規約
- `docs/common/operations-manual.md`: 人間向けの具体的な運用手順
- `docs/common/issue-template.md`: issue本文テンプレート
- `.github/ISSUE_TEMPLATE/feature.yml`: GitHub Issue Form
- `.github/pull_request_template.md`: PRテンプレート
- `.github/workflows/issue-contract-check.yml`: issue契約チェック
- `.github/workflows/pr-issue-link-check.yml`: PR本文チェック

## 利用開始時の入口

このファイルは、テンプレート公開元のREADME相当の情報を置く場所です。

テンプレートから新しいプロジェクトを始める具体的な手順は、`docs/common/operations-manual.md` を参照してください。

`docs/system-context.md` は、このテンプレートに含まれる固定ファイルではありません。新しいプロジェクトの概要、対象ユーザー、技術スタック、権限、運用前提などをAIエージェントへ渡し、初期化手順の中で生成するプロジェクト固有のドキュメントです。

## テンプレート本体の運用

このテンプレートリポジトリ自体も、issueを起点に変更内容を管理します。

ただし、テンプレート本体はアプリケーションプログラムではないため、利用先プロジェクトと同じ要件定義、設計、API定義、実装、テストの全工程を必須とはしません。テンプレート本体の運用で従うのは、主に **issueで目的、スコープ、受け入れ条件、検証観点を明確にしてから変更する** という issue 運用です。

GitHubへ公開して Actions を有効にすると、テンプレート本体に対する issue や PR にも以下のチェックが働きます。

- issue作成・更新時に、Issue Formの必須項目が揃っているかを確認する
- 必須項目が揃っているissueには `ready-for-ai` ラベルを付ける
- 不足があるissueには `needs-info` ラベルを付け、確認コメントを追加する
- PR本文に `Closes #123` 形式の対応issueと `実行した検証` が含まれるかを確認する

テンプレート本体を変更するissueでは、例えば以下のように記載します。

- App name: AI Driven Development Template
- Target platform: Documentation
- Purpose: テンプレートガイドにテンプレート本体の運用方針を追記する
- Scope: `docs/common/template-guide.md` の「テンプレート本体の運用」セクションを更新する
- Non-scope: 利用先プロジェクトの開発規約やGitHub Actionsの仕様変更は含めない
- Acceptance criteria: テンプレート本体ではissue運用のみを適用することがテンプレートガイドから読み取れる
- Test perspectives: テンプレートガイドの記載が現在の `.github/` ファイル構成と矛盾していないことを確認する
- Related documents: `docs/common/template-guide.md`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/workflows/issue-contract-check.yml`

この運用により、テンプレート自体の改善も issue とPRの履歴として残せます。

## 想定スタック

`docs/common/development-rules.md` では、以下の構成を想定しています。

- Frontend: Flutter または Next.js
- Backend: Hono
- Infrastructure: AWS CDK v2
- Runtime: AWS Lambda + AWS Lambda Web Adapter
- Auth / Hosting: AWS Amplify

実際のプロジェクトで使う技術スタックは、最初に `docs/system-context.md` へ明記してください。

## AIエージェントへの依頼方法

作業を依頼するときは、GitHub issue本文またはissue番号を起点にしてください。

例:

```text
issue #123 に着手します。
AGENTS.md、docs/common/development-rules.md、docs/system-context.md、issue本文を読み、
目的、受け入れ条件、影響範囲、不明点、実装前に更新すべきドキュメントを報告してください。
```

`ready-for-ai` ラベルがないissueは、実装前に不足情報を確認する運用を推奨します。

## ライセンス

MIT License
