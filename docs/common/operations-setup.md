# 初期セットアップの詳細

初回の導入・移行を担当する人と、それを支援するAI向けの資料です。
日常の進め方は[運用マニュアル](operations-manual.md)を使ってください。以下の手順はAIへ調査・準備を依頼できます。権限や構成の判断が必要な箇所で人間が確認します。

- [新規導入・既存プロジェクトの確認](#テンプレート利用時の初期セットアップ)
- [Issue成果物の導入](#issue成果物テンプレートの利用)
- [v1からの移行](migration-v1-to-v2.md) / [隔離した導入例](../examples/v2-adoption/README.md)
- [検査ツールの利用](workflow-tools-guide.md)

## テンプレート利用時の初期セットアップ

このプロジェクトをテンプレートとして使う場合、`.github/` 配下の自動化用ファイルも一緒にコピーしてください。

コピー対象は以下です。

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.gitattributes`
- `.gitignore`
- `LICENSE`
- `docs/common/template-guide.md`
- `docs/common/development-rules.md`
- `docs/common/operations-manual.md`
- `docs/common/operations-setup.md`
- `docs/common/operations-reference.md`
- `docs/common/workflow-tools-guide.md`
- `docs/common/quality-gates.md`
- `docs/common/issue-template.md`
- `docs/examples/issues/001-user-profile-edit.md`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/pull_request_template.md`
- `.github/workflows/issue-contract-check.yml`
- `.github/workflows/pr-issue-link-check.yml`

`README.md` は利用先プロジェクト用の雛形です。テンプレート公開元のREADME相当の情報は `docs/common/template-guide.md` に置き、日常の入口は`docs/common/operations-manual.md`、詳しい手順・例・コマンドは同文書から参照する資料に置きます。

`AGENTS.md` はAIエージェント共通の入口です。詳細な規約は `docs/common/development-rules.md` に置き、各AI開発ツール向けの入口ファイルからも `AGENTS.md` を参照させます。

`.github/` 配下のファイルは、GitHub Issue Form、PRテンプレート、issue/PRチェック用のGitHub Actionsです。基本的にはコピー後そのまま利用できます。

### GitHubを使わない場合

このテンプレートは、GitHub Issues、Pull Request、GitHub Actions を使う運用を標準としています。GitHubを使わない場合に読み替える項目や編集するファイルは、テンプレート公開元README相当の `docs/common/template-guide.md` を参照してください。

### AI開発ツールごとの入口

このテンプレートの中心は、特定のAI開発ツールではなく、GitHub issue と `docs/` 配下のドキュメントを作業契約にする運用です。

そのため、各ツール固有のファイルや機能は、共通ルールへの入口または補助として扱います。

- **共通**: `AGENTS.md` をAIエージェント共通の入口として置く。詳細規約は `docs/common/development-rules.md`、人間向け手順は `docs/common/operations-manual.md` に集約する。
- **Codex**: `AGENTS.md` を入口として使う。Codexのスキルは必須ではなく、複数プロジェクトで同じ手順を繰り返す場合や、GitHub issue作成、要件定義、PR作成などを専用ワークフローとして強制したい場合に追加する。
- **Claude Code**: `CLAUDE.md` を入口として使い、そこから `AGENTS.md` と `docs/common/development-rules.md` を参照させる。必要に応じて `.claude/commands/` にプロジェクト用slash commandを追加し、チーム共有する権限設定は `.claude/settings.json` で管理する。
- **その他のAI開発ツール**: ツールが自動で読む規約ファイルやルール機能がある場合は、そのファイルから `AGENTS.md` と `docs/common/development-rules.md` を参照させる。ツール固有の権限設定、コマンド、メモリ、コンテキスト読み込み仕様は、利用ツールに合わせて調整する。

ツール固有の設定を追加する場合でも、issueを作業契約にすること、issue外の変更を勝手に実装しないこと、実装前に要件・設計・API・検証観点を確認することは共通ルールとして維持します。ツールの権限や自動実行の範囲を広げる場合は、セキュリティ上の影響を確認し、必要に応じて `docs/common/operations-manual.md` に運用差分を追記してください。

### マルチエージェント利用時の運用

マルチエージェント運用は、Codex、Claude Code、その他のAI開発ツールを含む一般ルールとして扱います。特定ツールの機能名や実装方式に依存せず、GitHub issue と `docs/` 配下のドキュメントを作業契約にする原則を維持します。

`ready-for-ai` ラベルは「AIに依頼できる状態」を示すラベルです。AIエージェントの自動着手、担当確定、排他制御を意味しません。

ここでいう担当（assignee）は、issueの責任を持つ人間のGitHubアカウントを指します。AIエージェント名やツール名ではありません。AIエージェントは、担当（assignee）に設定された人間から明示的に依頼された場合に作業します。

人間は、通常のissue依頼時にマルチエージェント機能を意識する必要はありません。AIエージェントにissue番号を渡すと、AIがissueの目的、スコープ、変更範囲、検証観点を読み、マルチエージェント化が有効かを判断します。

AIがマルチエージェント化が有効だと判断した場合は、作業開始前に分割案を提示します。人間はその案を承認、修正、または却下します。人間が明示的に指示した場合を除き、AIが判断だけで複数エージェント作業を開始する運用にはしません。

マルチエージェント化が有効な例:

- 調査、設計、実装、検証を独立して進められる。
- 変更対象ファイルや責任範囲を明確に分離できる。
- 片方の作業結果を待たずに、別の確認作業を並行できる。
- 複数の観点でレビューした方が、受け入れ条件の漏れを減らせる。

単一エージェントで進める例:

- 小さなドキュメント修正。
- 単一ファイルの文言修正。
- 仕様が未確定で、人間の判断待ちが多いissue。
- 変更範囲が密結合で、並行作業すると衝突しやすいissue。

複数人または複数AIエージェントで開発する場合は、作業開始前に以下を確認します。

- issueに `ready-for-ai` ラベルが付いている。
- issueに担当（assignee）が設定されている。
- 担当者または依頼者が、issueコメントで着手を宣言している。
- 既に別の担当者、AIエージェント、PRが同じissueに着手していない。
- 変更予定ファイルまたは担当領域が、issue本文または着手コメントで明確になっている。

担当（assignee）が未設定のissueは、AIエージェントに着手させてはいけません。まず人間が担当を設定し、必要に応じて着手コメントを追加します。

1つのissueを複数エージェントに分割することは、並行作業が有効な場合に限って許可します。その場合でも、issue全体の責任を持つ primary agent または統合担当者を1つ決めます。

複数エージェントに分割する前に、以下を明確にします。

- primary agent または統合担当者。
- 各エージェントの担当目的。
- 各エージェントの変更可能なファイルまたは領域。
- 各エージェントが触ってはいけない非担当領域。
- 統合時に確認する受け入れ条件と検証観点。
- 作業結果をPRにまとめる担当者。
- 単一エージェントで進める場合と比べた利点とリスク。

分割例:

- 調査担当: 既存ドキュメントとissue本文の矛盾を確認し、変更案だけを提示する。
- 実装担当: 指定されたファイルだけを更新する。
- 検証担当: 更新後のドキュメントが受け入れ条件と矛盾しないか確認する。
- 統合担当: 各エージェントの結果を読み、最終差分、検証結果、PR本文を整理する。

禁止事項:

- 担当（assignee）未設定のissueへAIエージェントを着手させること。
- `ready-for-ai` ラベルだけを根拠に、担当者確認なしで作業を始めること。
- 人間の承認なしに、AI判断だけで複数エージェント作業を開始すること。
- 同一issueに複数エージェントを割り当てる際、担当ファイルや統合担当を決めずに並行作業させること。
- issue外の改善、リファクタリング、仕様追加をエージェント判断で行うこと。
- あるエージェントの変更を、別エージェントが理由なく巻き戻すこと。

新しいラベル、GitHub Actionsによる自動アサイン、AI botやGitHub Appによる自動着手制御は、このテンプレートの初期運用には含めません。必要になった場合は、別issueでラベル体系、権限、自動実行条件、対象issueの制限を設計します。

テンプレート本体の改善issueでは、利用先プロジェクトに不要な履歴ドキュメントを残さないため、原則として `docs/requirements/` や `docs/design/` にissue別ドキュメントを作成しません。issue本文を作業契約とし、必要な変更は `docs/common/`、`AGENTS.md`、`.github/` などのテンプレート構成ファイルへ直接反映します。

### GitHubリポジトリを作るタイミング

GitHubリポジトリは、テンプレートから新規プロジェクトを作成した直後、最初のissueを作る前に作成することを推奨します。

おすすめの流れは以下です。

1. テンプレートから新規プロジェクトを作成する。
2. アプリ名、リポジトリ名、公開範囲を決める。
3. `README.md` を利用先プロジェクトの内容に合わせて更新する。
4. GitHubリポジトリを作成し、初期状態をpushする。
5. GitHub Issues と GitHub Actions が有効になっていることを確認する。
6. プロジェクト初期化をAIへ依頼し、`docs/system-context.md` と `docs/architecture.md` を作成する。
7. `docs/system-context.md` に記載された機能単位一覧と `docs/architecture.md` の採用構成を確認し、要件定義、設計、実装、テストへ進める単位に分割する。
8. 分割した機能単位ごとに GitHub Issue Form でissueを作成する。
9. `ready-for-ai` ラベルが付き、担当（assignee）が設定されたissueからAIに作業を依頼する。

ローカルで作業を進めてからGitHub化すると、issue番号、PR、Actions、AIへの作業契約が後付けになりやすくなります。issueベース開発では、リポジトリ作成を開発開始時の最初の手順として扱います。

### AIにGitHubリポジトリ作成を依頼する

`gh` CLIがインストール済みで、GitHubにログイン済みであれば、リポジトリ作成もAIに依頼できます。

事前に人間が決める項目は以下です。

- GitHub owner: 個人アカウントまたはOrganization名
- リポジトリ名
- 公開範囲: public / private
- デフォルトブランチ名: 通常は `main`
- 初期コミットメッセージ

**プロンプト:**

> このプロジェクトをGitHubリポジトリとして初期化してください。
>
> - GitHub owner: [owner]
> - リポジトリ名: [repository-name]
> - 公開範囲: [public / private]
> - デフォルトブランチ: main
> - 初期コミットメッセージ: Initial project template setup
>
> 実行前に、現在のディレクトリ、`git status`、`gh auth status` を確認してください。
> 既存のGit履歴やremoteがある場合は、上書きせずに状況を報告してください。
> 問題なければ、GitHubリポジトリを作成し、現在の内容を初期コミットとしてpushしてください。
> push後に、GitHub Issues と GitHub Actions が利用可能か確認し、最初のissueを作れる状態か報告してください。

AIが実行する代表的なコマンドは以下です。実際のコマンドは、現在のGit状態を確認してからAIに判断させます。

```bash
git init
git add .
git commit -m "Initial project template setup"
git branch -M main
gh repo create [owner]/[repository-name] --private --source=. --remote=origin --push
```

公開リポジトリにする場合は `--private` を `--public` に変更します。既にGit管理されている場合やremoteが設定済みの場合は、AIに既存状態を確認させてから進めます。

### コピー後に確認すること

- GitHub Issues が有効になっている。
- GitHub Actions が有効になっている。
- Actions の `GITHUB_TOKEN` に issue / PR への書き込み権限がある。
- `.github/workflows/*.yml` がデフォルトブランチに入っている。
- Issue Formの項目名を変更した場合、`issue-contract-check.yml` のチェック文字列も更新している。
- チーム運用では、`main` ブランチ保護を設定し、direct push 禁止、PR必須、必要なActions成功必須を有効にしている。

`needs-triage`、`feature`、`needs-info`、`ready-for-ai` ラベルはworkflowが自動作成します。手動作成は不要です。

### 既存プロジェクトへ導入する場合

既存コードベースへこのテンプレートを導入する場合は、AIにいきなり機能実装やリファクタリングを依頼しません。まず調査専用issueを作成し、既存構成をリバースエンジニアリングします。

調査専用issueでは、以下を整理します。

- ディレクトリ構成と主要責務。
- 技術スタック、起動方法、テスト方法、ビルド方法。
- Frontend、Backend、Infrastructure、Auth、Data Store、External Services の現状。
- API、認証認可、データモデル、環境変数、シークレット、デプロイ前提。
- 既存ドキュメントと不足しているドキュメント。
- `docs/system-context.md` と `docs/architecture.md` の作成または更新案。
- 後続issue候補。

調査専用issueの非スコープには、機能実装、リファクタリング、依存関係更新、API仕様変更、Infrastructure変更を明記します。既存コードを理解する前にAIへ変更させると、暗黙の構成や運用前提を壊しやすくなるためです。

**既存プロジェクト調査プロンプト:**

> 既存プロジェクトへAI駆動開発テンプレートを導入するための調査issueに着手します。
> `AGENTS.md` と `docs/common/development-rules.md` を読み、まだ機能実装やリファクタリングは行わないでください。
>
> まず既存コードベースを調査し、以下を整理してください。
>
> - ディレクトリ構成と主要責務
> - 技術スタック
> - 起動、ビルド、テスト、デプロイ方法
> - Frontend、Backend、Infrastructure、Auth、Data Store、External Services の現状
> - API、認証認可、データモデル、環境変数、シークレット、デプロイ前提
> - 既存ドキュメントと不足しているドキュメント
> - `docs/system-context.md` と `docs/architecture.md` の作成または更新案
> - 後続issue候補
>
> このissueではコード変更、依存関係更新、API仕様変更、Infrastructure変更は行わないでください。

### 適応ワークフローの設計

1つのIssue内部における、作業規模に応じた工程選択、中断からの再開、フェーズ境界の追跡性検査、ルールのモジュール化、Brownfield解析、ワークフローのGolden Testについては、`docs/common/adaptive-workflow-design.md` に共通設計を定義しています。

この設計はIssue契約、assignee、`ready-for-ai`、変更リスク分類、Quality Gates、人間の承認を置き換えません。Issue成果物のschema v1とYAMLテンプレート、同梱例の形式テストが利用できます。計画・状態・再開候補の静的checkerも利用できます。追跡性checkerも利用できます。工程自動実行は提供しません。導入時は既存運用を維持し、機構ごとに追加方式で有効化します。

### Issue成果物テンプレートの利用

1. `.ai-workflow/templates/issue/v1/`からplan、state、traceabilityを作業用の`.ai-workflow/issues/<work-id>/`へコピーします。Brownfield調査時だけbrownfieldも使います。
2. 合成例のID、Issue URL、actor、日時、Git commit、工程、調査結果を実際の作業へ置換します。空配列やnullは未記入・該当なしの初期値であり、承認や完了の証拠ではありません。
3. 人間向けのplan.mdやbrownfield.mdはYAMLの説明として記述し、同じ状態を独立して管理しません。
4. schemaで形式を確認したうえで、人間が参照先、履歴、承認、成果物の対応をレビューします。現在の同梱テストはrepositoryのtemplate・fixtureが対象で、任意の作業ファイルを自動走査しません。

schemaの項目、参照形式、後続checkerとの分担は`adaptive-workflow-design.md`の4.1～4.3を参照してください。schemaとテストを利用する場合は、隠しディレクトリを含む`.ai-workflow/schemas/`、`.ai-workflow/templates/`、`tools/workflow-schema/`、`tests/workflow-schema/`を一緒にコピーします。

Node.js 22以上とnpmを用意し、repository rootで次を実行します。初回の依存取得にはネットワークが必要です。lockfileで固定された依存取得後のテストはオフラインで動きます。

```bash
npm ci --prefix tools/workflow-schema --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-schema
```

テストは外部AI、GitHub API、成果物内のcommandを呼び出しません。成功しても実際のIssue作業が承認済み・完了済みとは判断しません。診断はcase IDごとにartifact、instance path、schema path、keywordで確認できます。エラー時は元データを保存し、`versioning-policy.md`の手順に従って従来運用へ戻せます。

複数feature / Issue / 開発者をまたぐ開発順序、チーム台帳、担当割当、claim、進捗集約、AI主導の次Issue選択は、`docs/common/project-orchestration-design.md`で別のプロジェクト統制機構として設計しています。このIssue内部ワークフローだけでは実行しません。

### プロジェクト統制の設計

`docs/common/project-orchestration-design.md`は、`docs/system-context.md`で分割したfeatureの依存順序、工程進捗、開発メンバー、担当・claim、共有領域の競合防止を定義します。初期標準はGitHub Issuesと人間のCoordinatorを使う方式で、GitHub Projects、中央Dispatcher、外部Agent Runnerは任意の後続拡張です。

Project設定・開発計画・メンバー台帳のschema v1と合成記入例、依存DAG・wave・計画改訂とmember/ownership/capacityの読み取り専用validatorは利用できます。読み取り専用の集約・推薦も利用できます。実GitHub取得・割当操作等は後続対応です。AIへ「開発を続けてください」と依頼すると、AIは現在の作業や次の候補を確認して進め方を組み立てます。未割当Issueの担当確定や競合調整が必要な場合は、人間へ確認します。checkerは読み取り専用で、実GitHubの割当操作やclaimを自動実行するものではありません。

