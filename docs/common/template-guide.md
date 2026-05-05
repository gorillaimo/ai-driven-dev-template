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
- `docs/common/template-guide.md`: テンプレート本体の説明、公開設定、利用時の読み替えガイド
- `docs/common/issue-template.md`: issue本文テンプレート
- `docs/examples/issues/001-user-profile-edit.md`: issue記載例
- `.github/ISSUE_TEMPLATE/feature.yml`: GitHub Issue Form
- `.github/pull_request_template.md`: PRテンプレート
- `.github/workflows/issue-contract-check.yml`: issue契約チェック
- `.github/workflows/pr-issue-link-check.yml`: PR本文チェック

## 利用開始時の入口

このファイルは、テンプレート公開元のREADME相当の情報を置く場所です。

`README.md` は、GitHub上で初めてこのテンプレートを見る人の入口であり、同時に利用先プロジェクトのREADME雛形でもあります。そのため、詳細な設計意図、公開設定、GitHubを使わない場合の読み替えは、この `docs/common/template-guide.md` に集約します。

テンプレートから新しいプロジェクトを始める具体的な手順は、`docs/common/operations-manual.md` を参照してください。実際のissue記載例は `docs/examples/issues/001-user-profile-edit.md` を参照してください。

`docs/system-context.md` は、このテンプレートに含まれる固定ファイルではありません。新しいプロジェクトの概要、対象ユーザー、技術スタック、権限、運用前提などをAIエージェントへ渡し、初期化手順の中で生成するプロジェクト固有のドキュメントです。

## 公開前に整えること

このテンプレートをpublicリポジトリとして公開する前に、以下を確認してください。

### READMEを初見向けに整える

GitHubのREADMEは、記事や検索から来た人が最初に読む入口です。以下が数分で分かる状態にします。

- 何のテンプレートか。
- 誰向けか。
- どの課題を解決するか。
- 最短でどう使い始めるか。
- 詳細説明や運用手順をどこで読むか。

READMEには詳細な運用思想を詰め込みすぎず、詳しい説明は `docs/common/template-guide.md`、具体的な手順は `docs/common/operations-manual.md` へ誘導します。

### template-guideを公開元README相当にする

`docs/common/template-guide.md` は、テンプレート本体の設計意図を説明する場所です。利用先プロジェクトのREADMEとは役割を分け、以下を記載します。

- AI駆動開発テンプレートとしての目的。
- Everything as Codeとして管理する対象。
- 各ファイルの役割。
- GitHubを使う場合、使わない場合の読み替え。
- AI開発ツールごとの入口。
- テンプレート本体を改善するときの運用。

### サンプルissueを用意する

空のissueテンプレートだけでは、利用者が記載粒度を判断しづらくなります。`docs/examples/issues/001-user-profile-edit.md` のような実開発で頻出する完成例を用意し、READMEや運用マニュアルから参照できるようにします。

サンプルissueは、以下を伝えるために置きます。

- issueがAIとの作業契約であること。
- スコープと非スコープを分けること。
- 受け入れ条件をチェック可能にすること。
- テスト観点を実装前に明記すること。
- 不明点を推測で埋めず、未決事項として残すこと。

### GitHubのTemplate repositoryを有効にする

GitHub repository settingsで **Template repository** を有効にすると、利用者が `Use this template` から新しいリポジトリを作成できます。

cloneだけで利用しても問題ありませんが、Template repositoryを有効にすると以下の利点があります。

- 利用者がremoteの付け替えを意識せず始められる。
- テンプレートから作成した新規プロジェクトとして履歴を分離できる。
- GitHub上の導線が分かりやすくなる。

### topicsを設定する

GitHub repositoryのAbout欄にtopicsを設定すると、GitHub検索や関連リポジトリから見つけてもらいやすくなります。

推奨topics:

- `ai-driven-development`
- `coding-agent`
- `github-issues`
- `everything-as-code`
- `template`
- `codex`
- `claude-code`
- `developer-productivity`

topicsは機能には影響しません。公開後に、このテンプレートを必要とする人へ届きやすくするためのメタ情報です。

## テンプレート本体の運用

このテンプレートリポジトリ自体も、issueを起点に変更内容を管理します。

ただし、テンプレート本体はアプリケーションプログラムではないため、利用先プロジェクトと同じ要件定義、設計、API定義、実装、テストの全工程を必須とはしません。テンプレート本体の運用で従うのは、主に **issueで目的、スコープ、受け入れ条件、検証観点を明確にしてから変更する** という issue 運用です。

GitHubへ公開して Actions を有効にすると、テンプレート本体に対する issue や PR にも以下のチェックが働きます。

- issue作成・更新時に、Issue Formの必須項目が揃っているかを確認する
- 必須項目が揃っているissueには `ready-for-ai` ラベルを付ける
- 不足があるissueには `needs-info` ラベルを付け、確認コメントを追加する
- PR本文に `Closes #123` 形式の対応issueと `実行した検証` が含まれるかを確認する

テンプレート本体を変更するissueでは、例えば以下のように記載します。

- アプリ名: AI Driven Development Template
- 対象プラットフォーム: Documentation
- 目的: テンプレートガイドにテンプレート本体の運用方針を追記する
- スコープ: `docs/common/template-guide.md` の「テンプレート本体の運用」セクションを更新する
- 非スコープ: 利用先プロジェクトの開発規約やGitHub Actionsの仕様変更は含めない
- 受け入れ条件: テンプレート本体ではissue運用のみを適用することがテンプレートガイドから読み取れる
- テスト観点: テンプレートガイドの記載が現在の `.github/` ファイル構成と矛盾していないことを確認する
- 参照ドキュメント: `docs/common/template-guide.md`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/workflows/issue-contract-check.yml`

この運用により、テンプレート自体の改善も issue とPRの履歴として残せます。

## マルチエージェント運用

このテンプレートでは、マルチエージェント運用を特定ツール専用の機能ではなく、Codex、Claude Code、その他AI開発ツールを含む一般ルールとして扱います。

`ready-for-ai` はAIに依頼できる状態を示すラベルであり、自動着手や担当確定を意味しません。AIエージェントに作業させるissueには、事前に担当（assignee）を設定します。ここでいう担当（assignee）は、issueの責任を持つ人間のGitHubアカウントです。

人間は、通常のissue依頼時にマルチエージェント機能を意識する必要はありません。AIが必要性を判断し、有効な場合は分割案を提示します。人間が承認した場合にのみ、複数エージェントで作業します。

1つのissueを複数エージェントに分割する場合は、primary agentまたは統合担当者、各エージェントの担当範囲、変更予定ファイルを事前に明確にします。

具体的な運用手順は `docs/common/operations-manual.md` を参照してください。

## GitHubを使わない場合

このテンプレートは、GitHub Issues、Pull Request、GitHub Actions を使う運用を標準としています。

GitHubを使わないプロジェクトでは、利用する管理ツールに合わせて、以下の対応関係を決めてから運用してください。

- GitHub issue に相当する作業単位。
- issue番号に相当するID。
- `ready-for-ai` ラベルに相当する状態、タグ、カスタムフィールド。
- 担当（assignee）に相当する担当者フィールド。
- Pull Request に相当するレビュー単位。
- `Closes #123` に相当する完了リンクまたは参照形式。
- GitHub Actions によるチェックに相当する確認方法。

例:

- Jira / Linear / Backlog のチケットを作業契約として扱う。
- Notion / Markdown ファイルで `docs/common/issue-template.md` 相当の項目を管理する。
- `ready-for-ai` はステータス、タグ、カスタムフィールドで表現する。
- 担当（assignee）は担当者フィールドで表現する。
- Pull Request がない場合は、Merge Request、変更レビュー記録、レビュー済みコミットで代替する。

GitHubを使わない場合でも、以下の原則は維持してください。

- 作業単位を明確にする。
- 作業契約に目的、スコープ、非スコープ、受け入れ条件、検証観点を書く。
- AIに依頼できる状態を明確にする。
- 担当者を明確にする。
- AIは作業契約外の変更をしない。
- 完了時に検証結果と残課題を残す。

### GitHubを使わない場合に編集するファイル

GitHubを使わない場合は、以下のファイルに含まれる GitHub 固有の表現を、利用する管理ツールに合わせて書き換えてください。

AIが読むファイル:

- `AGENTS.md`
  - `GitHub issue本文` を、利用する管理ツールの作業チケット、タスク、または `docs/issues/*.md` に置き換える。
  - `ready-for-ai` ラベルを、管理ツール上のステータス、タグ、カスタムフィールドに置き換える。
  - `担当（assignee）` を、管理ツール上の担当者フィールドに置き換える。
  - `PR本文` や `Closes #123` を、利用するレビュー・完了記録の形式に置き換える。
- `docs/common/development-rules.md`
  - `GitHub issue`、`GitHub Issue Form`、`ready-for-ai`、`担当（assignee）`、`PR`、`Closes #123` などの用語を、利用する管理ツールの用語へ置き換える。
  - AIが作業開始時に確認する作業契約の場所を明記する。
  - AIが完了時に検証結果や残課題を残す場所を明記する。
- `CLAUDE.md`
  - Claude Codeを使う場合、`GitHub issue本文` や `ready-for-ai` の参照先を、利用する管理ツールに合わせて置き換える。
- `docs/common/issue-template.md`
  - GitHub issue番号またはURLの欄を、チケットID、タスクURL、またはMarkdownファイルパスに置き換える。
  - 管理ツールで入力する項目名に合わせる。

人間向けの運用ファイル:

- `docs/common/operations-manual.md`
  - GitHub issue作成、PR作成、GitHub Actions確認の手順を、利用する管理ツールとCIの手順へ置き換える。
  - 人間がAIへ依頼するときのプロンプト例を、GitHub issue番号ではなく、チケットIDやファイルパスを渡す形に変更する。
- `docs/common/template-guide.md`
  - テンプレート公開元README相当の説明として、GitHub以外の運用を正式に採用する場合は、その前提を追記する。

GitHub専用ファイル:

- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/pull_request_template.md`
- `.github/workflows/issue-contract-check.yml`
- `.github/workflows/pr-issue-link-check.yml`

GitHubを使わない場合、これらはそのままでは機能しません。不要なら削除し、利用する管理ツールやCIに合わせて代替ファイルを用意してください。

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
