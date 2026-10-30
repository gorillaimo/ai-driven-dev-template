# 生成AIコーディング・運用マニュアル

このマニュアルは、`development-rules.md` に基づき、**issueを開発の最小単位**としてAI駆動開発を進めるために人間が読む手順書です。

`development-rules.md` はAIに読ませる規約です。このファイルは、人間がissueをどう切り、どのタイミングでAIへ何を依頼し、どこを確認するかを定義します。

## 1. 基本方針

すべての開発は、以下のサイクルで進めます。

1. **issueを作る**: 目的、背景、完了条件、影響範囲を明文化する。
2. **ドキュメントを育てる**: issueに基づき、要件・設計・API定義を更新する。
3. **テストで縛る**: 完了条件をテストへ落とし、AIの根拠なき実装を防ぐ。
4. **コードを生成する**: テストと設計を根拠に、最小差分で実装する。
5. **issueを閉じる**: 受け入れ条件、テスト結果、ドキュメント更新を確認する。

issueは単なるタスクメモではなく、AIと人間が共有する「作業契約」です。AIに依頼するときは、必ずissue本文またはissue番号を起点にします。

## 2. テンプレート利用時の初期セットアップ

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
- `docs/common/quality-gates.md`
- `docs/common/issue-template.md`
- `docs/examples/issues/001-user-profile-edit.md`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/pull_request_template.md`
- `.github/workflows/issue-contract-check.yml`
- `.github/workflows/pr-issue-link-check.yml`

`README.md` は利用先プロジェクト用の雛形です。テンプレート公開元のREADME相当の情報は `docs/common/template-guide.md` に置き、具体的な運用手順はこの `docs/common/operations-manual.md` に集約します。

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

Project設定・開発計画・メンバー台帳のschema v1と合成記入例、依存DAG・wave・計画改訂とmember/ownership/capacityの読み取り専用validatorは利用できます。割当・集約等は後続実装です。現時点では、AIへ「開発を続けてください」と指示しても、AIが未割当Issueを自動claimしたり、複数人の作業を自動調整したりできるとは扱わないでください。従来どおり、人間がassignee、着手コメント、変更範囲、既存PRを確認します。

## 3. issueの粒度

### 良いissue

- 1つの目的に集中している。
- 完了条件がチェック可能である。
- 仕様変更、実装、テスト、ドキュメント更新の範囲が説明されている。
- 共通APIやデータモデルに触れる場合、その影響が書かれている。

### 分割した方がよいissue

- 要件が未確定な調査と、実装が同じissueに入っている。
- Backend、Frontend、Infrastructure、API仕様の変更が大きく絡み、レビューが重くなる。
- `docs/system-context.md`、`docs/architecture.md`、`docs/api/openapi.yaml` など共通定義の変更が、複数機能へ波及する。

迷った場合は、先に「調査・設計issue」を作り、その結果から実装issueを作ります。

初回のプロジェクト初期化では、いきなり個別機能のissueを作るのではなく、まず `docs/system-context.md` に全体要件と機能単位一覧を作成し、`docs/architecture.md` に採用アーキテクチャを作成します。人間はその一覧と構成判断を確認し、開発対象として妥当な粒度に調整してから、機能単位ごとにissueを作成します。

機能単位一覧には、以下を含めることを推奨します。

- 機能名
- 目的
- 想定ユーザーまたはロール
- 主なスコープ
- 主な非スコープ
- 依存する機能または先行issue候補
- 要件定義以降へ進める優先度
- 未決事項

### issueとPRの対応

原則として、1つの機能issueは、要件定義、設計、API定義、テスト、実装までを完了する1つのPRに対応させます。PRはissueの完了成果物として扱い、PR本文には対応issue、受け入れ条件ごとの対応、更新したドキュメント、実行した検証、残課題を記載します。

ただし、以下の場合は、要件・設計issueと実装issueを分け、要件・設計のみのPRを先に作成してレビューします。

- 機能の仕様が大きい、または不確実性が高い。
- 共通API、共通データモデル、認証、Infrastructure に影響する。
- 実装前に仕様レビューや合意形成が必要である。
- 1つのPRで要件、設計、実装、テストをまとめるとレビューが重くなる。

小さな機能では、1機能 = 1 issue = 1 PR を基本とします。大きな機能では、要件・設計issueと実装issueに分割し、各issueのPRで完了させる範囲を明記します。

### 変更リスクに応じた工程調整

issue作成時は、変更リスクを Low / Medium / High のいずれかで整理します。AIへ依頼する前に、リスク分類が妥当か人間が確認してください。

#### Low Risk

例:

- 文言修正、README修正、小さなドキュメント修正。
- テスト追加のみ。
- 明確な軽微バグ修正。

進め方:

- issue本文またはユーザー指示を確認する。
- 受け入れ条件と影響範囲を確認する。
- issue別の要件定義書や設計書は省略してよい。
- 必要な検証だけを実行し、結果を報告する。

#### Medium Risk

例:

- 通常の機能追加。
- 既存画面、既存API、既存データ構造を使う変更。
- 認証済みユーザー向けの標準的な機能。

進め方:

- issue、関連ドキュメント、受け入れ条件を確認する。
- 要件、設計、テスト観点を整理する。
- 実装前に人間が方針を確認する。
- テスト追加または更新を行う。

#### High Risk

例:

- 認証、認可、ロール、権限の変更。
- API仕様、共通データモデル、DB / Storage構造の変更。
- Infrastructure、AWSリソース、IAM、環境変数、デプロイ構成の変更。
- 外部サービス連携、決済、通知、メール、ファイルアップロード。
- 本番データ、個人情報、機微情報、セキュリティ、レジリエンスに影響する変更。

進め方:

- `docs/system-context.md` と `docs/architecture.md` を確認または更新する。
- 必要に応じて `docs/requirements/`、`docs/design/`、`docs/api/openapi.yaml` を更新する。
- `docs/common/quality-gates.md` に基づき、NFR / Security / Resiliency の該当有無を確認する。
- 実装前に人間が明示的に承認する。
- PR本文にQuality Gatesの確認結果、未確認事項、残課題を書く。

## 4. issueテンプレート

issue作成時は、必要に応じて `docs/common/issue-template.md` を利用してください。

記載粒度に迷う場合は、`docs/examples/issues/001-user-profile-edit.md` を参照してください。このサンプルは、実開発で頻出する機能追加issueの例です。

最低限、以下を埋めます。

- **目的**: なぜこの変更が必要か。
- **変更リスク**: Low / Medium / High とその理由。
- **スコープ**: 何をやるか、何をやらないか。
- **受け入れ条件**: 何が満たされれば完了か。
- **参照ドキュメント**: 関連する `docs/` 配下の仕様。
- **影響範囲**: Architecture / Frontend / Backend / Infrastructure / API / DB / Auth など。
- **テスト観点**: 正常系、異常系、権限、境界値。
- **Quality Gates**: NFR / Security / Resiliency の該当有無。

## 5. フェーズ別プロンプトテンプレート

このマニュアルの「フェーズ」は、人間がAIへ依頼するときの運用手順を表します。プロンプト内の「STEP」は、`docs/common/development-rules.md` に定義されたAI向け工程を表します。

対応関係は以下です。

| フェーズ | 対応するSTEP | 目的 |
| :--- | :--- | :--- |
| フェーズ0 | STEP 0 | プロジェクト初期化、全体定義、アーキテクチャ設計 |
| フェーズ0.5 | 任意 STEP 0.5 | プロトタイプ作成 |
| フェーズ1 | なし | issue作成・整理 |
| フェーズ2 | STEP 1-3 | 要件定義、設計、API定義 |
| フェーズ2.5 | STEP 3.5 | Quality Gates確認 |
| フェーズ3 | STEP 4のテスト先行部分 | 受け入れ条件に対応するテスト作成 |
| フェーズ4 | 実装 | テストと設計に基づく本実装 |

### フェーズ0：プロジェクト初期化（STEP 0）

AIにプロジェクト全体の前提を作らせます。これは初回、または大きな方向転換時だけ実施します。

このフェーズでは、個別機能の詳細要件や本実装には進みません。`docs/system-context.md` に全体要件を整理し、`docs/architecture.md` に採用アーキテクチャとデフォルト構成との差分を整理します。そのうえで、後続の要件定義、設計、実装、テストを行うissueへ分割するための機能単位一覧を作成します。

**プロンプト:**

> `@docs/common/development-rules.md` を読み込み、本プロジェクトの行動規範として扱ってください。
> 開発するアプリの概要は次の通りです。
>
> [ここに概要を入力]
>
> STEP 0 として `docs/system-context.md` と `docs/architecture.md` を作成してください。
> ビジョン、全体要件、主要ドメイン、用語集、権限、エラー、セキュリティ、運用上の前提を記述してください。
> `docs/architecture.md` には、採用アーキテクチャ、デフォルト構成との差分、技術スタック、クラウド、実行基盤、認証基盤、データストア、外部サービス、採用理由、未決事項を記述してください。
> 特に理由がない場合は、`@docs/common/development-rules.md` のデフォルト技術スタックを採用してください。
> デフォルト構成から外れる場合は、理由、比較した選択肢、影響範囲、人間に承認してほしい判断事項を明記してください。
>
> あわせて、要件定義、設計、実装、テストを行うissueとして分割すべき機能単位一覧を作成してください。
> 各機能単位には、機能名、目的、想定ユーザーまたはロール、主なスコープ、主な非スコープ、依存関係、優先度、未決事項を含めてください。
> まだ `docs/requirements/` や `docs/design/` の個別ファイルは作成しないでください。
> 最後に、人間が次に作成すべきissue候補を一覧で提示してください。

### フェーズ0.5：プロトタイプ作成（任意 STEP 0.5）

営業デモ、要件確認、画面遷移確認、技術検証のために、実際に動くプロトタイプを先に作る任意フェーズです。プロトタイプは、`docs/system-context.md` と `docs/architecture.md` を入力にします。

このフェーズの目的は、本番実装ではなく、動く画面や主要フローを見ながら要件と設計の解像度を上げることです。プロトタイプで判明した内容は、後続issue、要件定義、設計、API定義、アーキテクチャ設計へ反映してから本実装へ進みます。

プロトタイプでは、原則として以下を本番相当として扱いません。

- 本番DB
- 本番認証
- 本番決済
- 本番外部API
- 権限管理
- 監査ログ
- Infrastructure

画面遷移は、プロトタイプ前に主要フロー、画面一覧、入口、出口だけを仮決めします。詳細な遷移や例外パターンは、プロトタイプを触ったあとに見直し、要件定義と設計へ反映します。

**プロトタイプ作成プロンプト:**

> `@docs/common/development-rules.md`、`@docs/system-context.md`、`@docs/architecture.md` を読んでください。
> 営業デモ、要件確認、画面遷移確認、技術検証を目的として、プロトタイプ作成方針を整理してください。
>
> プロトタイプの目的は以下です。
>
> - 目的: [営業デモ / 要件確認 / 画面遷移確認 / 技術検証]
> - 想定ユーザー: [誰に見せるか]
> - 見せたい成功体験: [ユーザーが何を達成できればよいか]
> - 再現したい画面: [画面一覧]
> - 再現したい画面遷移: [主要フロー]
> - 再現しない範囲: [本番認証、本番DB、外部API、権限、監査ログなど]
> - 本番アーキテクチャとの差分: [差分なし / ダミー実装 / モック / ローカルのみ]
>
> まず `docs/prototype.md` を作成または更新し、目的、入力ドキュメント、再現する範囲、再現しない範囲、本番アーキテクチャとの差分、画面 / ユーザーフロー、検証方法を整理してください。
> その後、プロトタイプを実装する issue 案を提示してください。
> プロトタイプは本番品質として扱わず、本番実装へ進む前に、判明したことを `docs/requirements/`、`docs/design/`、`docs/api/openapi.yaml`、`docs/architecture.md`、または後続issueへ反映してください。

**プロトタイプ後の整理プロンプト:**

> 作成したプロトタイプを踏まえて、`docs/prototype.md` を更新してください。
>
> - プロトタイプで判明したこと
> - 要件定義へ反映すること
> - 設計へ反映すること
> - API定義へ反映すること
> - `docs/architecture.md` へ反映すること
> - 本実装へ流用するコードと破棄するコード
> - 後続issue候補
>
> まだ本実装には進まず、後続issue案と更新すべきドキュメントを提示してください。

### フェーズ1：issue作成・整理

実装前に、人間がissueを作るか、AIにissue案を作らせます。

初回開発では、フェーズ0で作成した `docs/system-context.md` の機能単位一覧と `docs/architecture.md` の採用構成を起点にします。人間は一覧を確認し、開発対象、優先度、分割粒度を調整したうえで、機能単位ごとにissueを作成します。AIにissue案を作らせる場合も、`docs/system-context.md` の機能単位一覧と `docs/architecture.md` のアーキテクチャ判断から対象機能を指定します。

**issue案作成プロンプト:**

> `@docs/common/development-rules.md` と `@docs/system-context.md` を読んでください。
> `@docs/architecture.md` も読み、採用アーキテクチャとデフォルト構成との差分を確認してください。
> `docs/system-context.md` の機能単位一覧を確認し、次の対象機能をissue化してください。
>
> [対象機能名、または追加要望を書く]
>
> まず、この対象機能を以下のどの単位でissue化すべきか判断してください。
>
> - 通常の機能issue: 要件定義、設計、API定義、テスト、実装までを1つのissue/PRで扱う。
> - 要件・設計issue: 不確実性が高いため、要件定義、設計、API方針までを先にレビューする。
> - 実装issue: 承認済みの要件・設計に基づき、テストと実装を行う。
>
> 判断理由も説明してください。
>
> そのうえで、`docs/common/issue-template.md` の形式に沿って、目的、スコープ、非スコープ、受け入れ条件、影響範囲、テスト観点を整理してください。
> 変更リスクを Low / Medium / High で分類し、分類理由、必要な工程、省略可能な工程、人間の承認が必要な判断を明記してください。
> High Riskの場合は、`docs/common/quality-gates.md` に基づき、NFR / Security / Resiliency の該当有無を整理してください。
> PRで完了させる範囲も明記してください。
> `docs/system-context.md` にない仕様は推測せず、未決事項として列挙してください。
> 実装に入らず、まずissue本文案だけを提示してください。

**既存issueを始めるプロンプト:**

> issue #[番号] に着手します。
> まず現在のブランチ、`git status`、最新の `origin/main` との差分を確認してください。
> 問題がなければ、issue番号と要約を含む作業ブランチを作成してください。
> 例: `feature/[issue-number]-[short-summary]`
>
> そのうえで、`@docs/common/development-rules.md`、`@docs/system-context.md`、`@docs/architecture.md`、issue本文、関連する `@docs/` を読み、以下を報告してください。
>
> - issueの目的
> - 受け入れ条件
> - 影響範囲
> - 変更リスク分類と理由
> - Quality Gatesの該当有無
> - 不明点
> - 実装前に更新すべきドキュメント
> - 作成した作業ブランチ名
>
> 不明点が解消するまで実装しないでください。
> `main` へ直接コミットまたはpushしないでください。

### フェーズ2：要件・設計・API定義（STEP 1-3）

issueが実装可能な粒度になったら、`docs/common/development-rules.md` に定義された STEP 1-3 を進めます。

まず `docs/common/development-rules.md` の STEP 1 である要件定義を具体化し、アプリ名、対象プラットフォーム、ユーザー、利用シーン、成功条件をAIに渡します。ここが曖昧だと、AIは画面、API、権限、テスト観点を推測しやすくなります。

テンプレート本体の改善issueでは、利用先プロジェクトに不要な履歴ドキュメントを残さないため、原則として `docs/requirements/` や `docs/design/` にissue別ドキュメントを作成しません。issue本文を作業契約とし、必要な変更は `docs/common/`、`AGENTS.md`、`.github/` などのテンプレート構成ファイルへ直接反映します。

**STEP 1 要件定義プロンプト:**

> issue #[番号] の要件定義を行います。
> `@docs/common/development-rules.md`、`@docs/system-context.md`、`@docs/architecture.md`、issue本文、関連する `@docs/` を読んでください。
>
> 前提情報は以下です。
>
> - アプリ名: [アプリ名]
> - アプリの概要: [何をするアプリか]
> - 対象プラットフォーム: [Next.js Web / Flutter iOS / Flutter Android / Flutter Web など]
> - アーキテクチャ: [デフォルト構成を採用 / `docs/architecture.md` に従う / 変更候補あり]
> - 対象ユーザー: [利用者の種類、ロール、権限]
> - 主な利用シーン: [いつ、どこで、何のために使うか]
> - 解決したい課題: [ユーザーまたは業務上の課題]
> - 今回作る機能: [機能名と概要]
> - 今回やらないこと: [非スコープ]
> - 入力: [ユーザー入力、API入力、外部イベントなど]
> - 出力: [画面表示、APIレスポンス、通知、保存データなど]
> - データ要件: [保存する情報、参照する情報、個人情報の有無]
> - 認証・認可: [ログイン要否、必要な権限、ロールごとの差]
> - メッセージ / 多言語対応: [ユーザー向け文言の管理場所、対象言語、将来の多言語対応要否]
> - 外部連携: [外部API、AWSサービス、決済、メールなど]
> - 成功条件: [ユーザーにとって成功と判断できる状態]
> - 受け入れ条件: [チェック可能な完了条件]
> - 例外・エラー: [想定される失敗、バリデーション、権限エラー]
> - 非機能要件: [パフォーマンス、セキュリティ、ログ、監査、アクセシビリティなど]
>
> 上記をもとに、規約の STEP 1 として `docs/requirements/[issue-number]-[feature].md` を作成してください。
> ただし、テンプレート本体の改善issueでは、issue別の要件定義書を作成せず、issue本文と既存共通ドキュメント更新で代替してください。
> 要件定義書には、目的、背景、対象ユーザー、対象プラットフォーム、アーキテクチャ前提、スコープ、非スコープ、ユースケース、機能要件、非機能要件、データ要件、認証認可、メッセージ / 多言語対応方針、例外パターン、受け入れ条件、テスト観点、未決事項を含めてください。
> 不明点がある場合は、推測で埋めずに「確認事項」として列挙してください。
> まず作成方針と確認事項を提示し、承認後にファイルへ反映してください。

STEP 1の内容が固まってから、設計とAPI定義へ進みます。

**STEP 2-3 設計・API定義プロンプト:**

> issue #[番号] に基づき、規約の STEP 1-3 を進めてください。
>
> - `docs/requirements/[issue-number]-[feature].md` の要件定義を再確認
> - `docs/design/[issue-number]-[feature].md` に設計を作成
> - API変更がある場合は `docs/api/openapi.yaml` の更新案を提示
> - テンプレート本体の改善issueでは、issue別の要件定義書・設計書を作成せず、issue本文と既存共通ドキュメント更新で代替
>
> まず変更方針と作成・更新ファイル一覧を提示してください。承認後に反映してください。

共通API、認証、データモデル、インフラ権限を変えるissueでは、実装前にドキュメント差分だけでレビューすることを推奨します。

### フェーズ2.5：Quality Gates確認（STEP 3.5）

設計とAPI方針が固まったら、実装前に `docs/common/quality-gates.md` を確認します。すべてのissueで全項目を満たす必要はありませんが、AIは該当有無と理由を明記します。

High Risk issueでは、Quality Gatesの確認結果を人間が承認してから、テスト作成と実装へ進みます。

**Quality Gates確認プロンプト:**

> issue #[番号] の実装前に、`@docs/common/quality-gates.md` を確認してください。
> issue本文、要件定義、設計、API定義、影響範囲をもとに、以下を整理してください。
>
> - 変更リスク分類: Low / Medium / High
> - NFR Gateの該当有無、確認結果、未確認事項
> - Security Gateの該当有無、確認結果、未確認事項
> - Resiliency Gateの該当有無、確認結果、未確認事項
> - 実装前に人間が承認すべき判断
> - 後続issue候補
>
> 該当しないゲートについても、該当なしと判断した理由を説明してください。
> High Riskの場合は、人間の承認があるまでテスト作成や実装に進まないでください。

### フェーズ3：テスト先行実装（STEP 4のテスト先行部分）

設計が承認されたら、先にテストを書かせます。

**プロンプト:**

> issue #[番号] の承認済み仕様に基づき、実装フェーズに移行します。
> まず受け入れ条件を満たすテストを作成してください。
>
> - 正常系
> - 異常系
> - 権限・認可
> - 境界値
> - 既存機能への回帰
>
> テスト作成後、まだ本体実装は行わず、テストが何を保証するか説明してください。

### フェーズ4：実装

テストの意図が妥当であることを確認してから実装します。

**プロンプト:**

> 作成したテストをパスするように、issue #[番号] の実装を行ってください。
> `@docs/common/development-rules.md` の規約に従い、Backend、Frontend、Infrastructure、API仕様、型生成への影響を確認してください。
> プロトタイプ由来の実装であれば、`@docs/prototype.md` の検証結果と、要件・設計へ反映済みの内容も確認してください。
> 最小差分で実装し、最後に実行した検証コマンドと結果を報告してください。

## 6. 人間側のレビュー観点

AIの出力やPRを確認するときは、以下をチェックします。

- [ ] issueの受け入れ条件がすべて満たされている。
- [ ] issue外の変更が混ざっていない。
- [ ] `docs/system-context.md` と矛盾していない。
- [ ] `docs/architecture.md` と矛盾していない。
- [ ] デフォルト構成から外れる変更では、理由、比較、影響範囲、承認結果が `docs/architecture.md` に記録されている。
- [ ] プロトタイプ由来の変更では、`docs/prototype.md` の検証結果が要件・設計・API定義・後続issueへ反映されている。
- [ ] プロトタイプコードを流用している場合は、本実装として必要な品質、テスト、セキュリティ、アーキテクチャ適合性が再確認されている。
- [ ] 変更リスク分類が Low / Medium / High で明記され、分類理由が妥当である。
- [ ] High Risk issueでは、実装前に人間の明示承認がある。
- [ ] `docs/common/quality-gates.md` に基づき、NFR / Security / Resiliency の該当有無と確認結果が整理されている。
- [ ] 要件・設計・API定義が実装前に更新されている。
- [ ] テンプレート本体の改善issueでは、不要なissue別要件定義書・設計書を作成していない。
- [ ] テストが受け入れ条件に対応している。
- [ ] ユーザー向け文言がコードへ直書きされず、メッセージ定義ファイルまたはメッセージ管理モジュールに集約されている。
- [ ] APIエラーは可能な限り安定したコードで表現され、表示文言への依存がFrontend側へ分離されている。
- [ ] BackendとFrontendの型安全が保たれている。
- [ ] Infrastructureの権限・環境変数・デプロイ設定が実装と連動している。
- [ ] 共通APIや共通モデルの変更が、別issueや別PRで合意されている。
- [ ] PR本文にissue番号、変更概要、実行した検証、残課題が書かれている。

## 7. チーム開発における同期手順

### GitHubで自動化できること

このリポジトリでは、GitHub上のissue運用を補助するために以下を用意します。

- `.github/ISSUE_TEMPLATE/feature.yml`: issue作成時に、アプリ名、対象プラットフォーム、受け入れ条件、テスト観点などをフォームで入力させる。
- `.github/pull_request_template.md`: PR本文に対応issue、受け入れ条件、実行した検証、残課題を書かせる。
- `.github/workflows/issue-contract-check.yml`: issue本文に必要項目があるか確認し、不足があれば `needs-info`、揃っていれば `ready-for-ai` を付ける。
- `.github/workflows/pr-issue-link-check.yml`: PR本文に `Closes #123` 形式のissueリンクと `実行した検証` があるか確認する。
- `.github/workflows/workflow-validation.yml`: Node.js 22/24でテンプレートの静的テスト・Golden Testと保存Issue YAMLの形式・参照を検査する。

これにより、GitHub IssuesをAIへの作業指示の入口として使いやすくなります。ただし、GitHub Actionsは仕様の妥当性までは判断できません。受け入れ条件が本当に正しいか、issueのスコープが適切かは人間が確認します。

ブランチ保護はGitHubリポジトリ設定で有効化します。このテンプレートの初期状態では強制しませんが、チーム運用では `main` への direct push を禁止し、PR経由のマージを必須にすることを推奨します。

### ブランチとpushの運用

通常開発では、AIに `mainへpushして` と依頼しません。issue単位で作業ブランチを作成し、そのブランチへpushしてPRを作成します。

作業途中のpushは、バックアップ、進捗共有、別環境での作業継続のために行います。途中pushはPR作成を意味しません。PRは、issue本文の「PRで完了させる範囲」を満たした時点で作成します。

AIへ依頼する場合は、以下のように指示します。

> issue #[番号] の作業ブランチを作成してください。
> 変更をコミットし、作業ブランチへpushしてください。
> その後、PR本文案を作成してください。
> `main` へ直接pushしないでください。

個人開発やテンプレート初期整備で `main` へ直接pushする場合は、人間がレビュー不要と判断し、明示的に `mainへpushしてよい` と依頼した場合に限ります。

チーム運用では、GitHubのブランチ保護で `main` への direct push を禁止し、PR経由でのみ反映することを推奨します。

作業途中の内容をpushしてissueに記録する場合は、以下のように指示します。

> ここまでの作業を作業ブランチへpushしてください。
> push後、issueに以下をコメントしてください。
>
> - pushしたブランチ名
> - 最新コミット
> - 変更概要
> - 実行した検証
> - 未解決事項
> - 次に行う作業
>
> まだPRは作成しないでください。
> `main` へ直接pushしないでください。

### 作業開始前

1. 最新のmainブランチを取得する。
2. GitHub Issue Formでissueを作成する。
3. `ready-for-ai` ラベルが付いていることを確認する。
4. 担当（assignee）が設定されていることを確認する。
5. issue本文を最新化する。
6. AIへ次のように指示する。

**プロンプト:**

> 最新のコードとドキュメントを反映しました。
> GitHub issue #[番号] に着手します。
> まず現在のブランチ、`git status`、最新の `origin/main` との差分を確認してください。
> 問題がなければ、issue番号と要約を含む作業ブランチを作成してください。
> 例: `feature/[issue-number]-[short-summary]`
>
> そのうえで、GitHub issue #[番号]、`@docs/system-context.md`、`@docs/architecture.md`、関連する `@docs/` を読み直し、現在の作業への影響を教えてください。
> issue本文を作業契約として扱い、受け入れ条件、非スコープ、不明点、作成した作業ブランチ名を先に報告してください。
> `main` へ直接コミットまたはpushしないでください。

### 作業中

- 仕様が変わったら、先にissue本文と `docs/` を更新します。
- AIがissue外の実装を始めたら止めます。
- 追加作業が見つかったら、原則として別issueに切り出します。
- 作業の区切りでは、作業ブランチへpushし、issueコメントに変更概要、検証結果、未解決事項、次の作業を記録します。
- 作業途中のpushでは、原則としてPRを作成しません。PRはissue本文の「PRで完了させる範囲」を満たしてから作成します。

### PR作成時

**プロンプト:**

> 今回の変更内容に基づき、PR概要を作成してください。
>
> - 対応issue
> - 受け入れ条件ごとの対応内容
> - 更新したドキュメント
> - プロトタイプ由来の確認結果
> - 実装した主要ロジック
> - Infrastructure / API / 型定義への影響
> - 実行した検証
> - 残課題または別issueに切り出す内容

## 8. トラブルシューティング

| 状況 | 対処法 |
| :--- | :--- |
| AIがissueを読まずに実装する | 「issueを作業契約として扱い、目的・受け入れ条件・影響範囲を再確認してください」と指示する。 |
| issueのスコープが大きすぎる | 調査、共通仕様、Backend、Frontend、Infrastructureなどに分割する。 |
| AIがテストを書かずにコードを書く | 「規約のTDDルールに戻り、まず受け入れ条件に対応するテストを作成してください」と指示する。 |
| AIが仕様を推測する | 「推測せず、不明点として質問してください。必要ならissue本文を更新します」と指示する。 |
| 途中で手動修正した | 「[ファイル名] を手動修正しました。再読解し、これを最新の正解として扱ってください」と伝える。 |
| issue外の改善が見つかった | 現issueには混ぜず、別issue候補としてPR本文に残す。 |

## 9. チーム共通のAI運用ルール

- `development-rules.md` の変更は、チームで合意してから行う。
- issueテンプレートや運用手順は、AIが迷いやすかった箇所を見つけたら継続的に改善する。
- AIへの依頼は、なるべくissue番号、関連ドキュメント、期待する成果物をセットで渡す。
- AIの出力は最終判断ではなく、issueの受け入れ条件に対する提案としてレビューする。

## モジュール式ルールの手動利用

Node.js 22以上で`npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund`を実行します。
インストール後、`npm test --prefix tools/workflow-rules`はネットワーク・外部AIなしで実行できます。
既存schemaの回帰は`node tools/workflow-schema/validate.mjs`で実行できます（同パッケージの依存を事前に導入）。

ルール正本は共通の`docs/common/rules/<rule-id>/`または利用先固有の`.ai-workflow/rules/<rule-id>/`です。
各directoryにrule.yamlとrule.mdを対で置き、rule_idとdirectory名を一致させます。
legacy以外はbody_refsに対のrule.mdを含めます。既存IDを同名projectルールで上書きできません。
`.ai-workflow/templates/rules/v1/`は合成記入例であり、自動採用・承認の記録ではありません。
rule.yamlはlegacy参照の例、context.yamlは既知空集合を含む例、resolution.yamlは解決結果の構造例です。
resolutionの入力digestは実際のrepositoryの最新文書から再生成します。

repository rootからの利用例:

```js
import { readFileSync } from 'node:fs';
import { loadRules, parseYaml } from './tools/workflow-rules/load.mjs';
import { resolveRules } from './tools/workflow-rules/resolve.mjs';
import { projectPlan } from './tools/workflow-rules/plan.mjs';

const input = {
  ...loadRules(process.cwd()),
  context: { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] },
  optIns: [],
};
const result = resolveRules(input);
if (result.status === 'blocked') throw new Error(JSON.stringify(result.diagnostics));
const plan = parseYaml(readFileSync('.ai-workflow/issues/issue-123/plan.yaml', 'utf8'));
const candidate = projectPlan(plan, result, input);
// 人間レビュー後、candidateのrevision・更新日時・actorを更新して明示保存する。
```

opt-inの採用例（実際の人間承認参照へ置換）:

```js
const optIns = [{
  rule_id: 'example', version: '1.0.0',
  approval: {
    approval_type: 'opt-in', approved_by: 'example-user',
    reference: { kind: 'url', target: 'https://github.com/example/project/issues/123#issuecomment-1' },
    approved_at: '2026-10-22T00:00:00Z',
  },
}];
```

`loadRules`の失敗、blocked診断、変更されたcontext/本文/digestを無視して以前の結果を使わないでください。
保存直前に再読込・再解決し、requires固定versionと採用承認の有効性を人間が確認します。
診断のcode/rule_id/relatedは機械処理用、説明文はtools/workflow-rules/messages.mjsに集約しています。
承認参照とapproval_requiredは承認そのものではなく、Issueのassignee・ready-for-ai・設計承認を引き続き確認します。
対処不能な場合は元成果物を保持してIssueへ理由を記録し、従来のIssue・branch・PR運用で人間へ戻します。

## 計画・状態・再開候補の静的検査

この検査は工程を実行せず、plan/state/contextを読み取って不足や矛盾を返します。
作業予定表（plan）、現在地と履歴（state）、人間が確認した状況（context）を分けて準備します。
記入例は`.ai-workflow/templates/checks/v1/`、全体を試す合成例は`tests/workflow-check/fixtures/`にあります。
JSON表記の例もYAML 1.2として読み込めます。例のID・時刻・参照・digestを実作業へ置換してください。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-check
npm test --prefix tools/workflow-rules
node tools/workflow-schema/validate.mjs
```

依存導入後の検査・テストはネットワーク不要です。既存schemaパッケージの依存は別途導入します。
workflow-checkはworkflow-rulesをfile依存で再利用し、rule側もruntime依存を明示しています。
ruleの計算規則は変更せず、rootにアプリ用package.jsonを追加しません。

repository rootから合成例を検査する例:

```js
import { loadWorkflow } from './tools/workflow-check/load.mjs';
import { checkWorkflow } from './tools/workflow-check/check.mjs';

const input = loadWorkflow(process.cwd(), {
  plan: 'tests/workflow-check/fixtures/plan.yaml',
  state: 'tests/workflow-check/fixtures/state.yaml',
  context: 'tests/workflow-check/fixtures/context.yaml',
  // 実作業の中断再開ではprevious: {plan: '...', state: '...'}も渡す。
  revisionPlans: [],
}, { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] }, []);
const result = checkWorkflow(input);
console.log(result);
```

実作業では、Git/Issueの最新状況を人間が確認してcontextへ反映し、ruleも保存直前に再読込します。
checkerはGitHub照会・Git command・ファイル更新をしません。snapshotの内容が本当かを自動認証しません。
通常ファイルを1 MiBまで読み、root外・symlink・不正YAMLを拒否します。loader失敗時は例外で停止します。
純粋関数checkWorkflowへはJSON相当のobjectを渡します。形式不正は診断付きblockedとなります。

state.extensions.workflow_checkへ承認・検証scopeと改訂情報を追加します。
High Riskは設計と品質確認の両方について、対象revisionの承認参照が必要です。
人間の承認参照を記入しただけで本人性が証明されたり、作業が自動実行されたりすることはありません。
履歴の途中状態、例外skip、標準イベントの具体的な契約はadaptive-workflow-design第5.4・6.4節を参照してください。

checks配列でplan/stateとresumeのどこが止まったかを確認します。
resume_decision: candidateの場合だけnext_stageが1つ提示されますが、これは作業開始命令ではありません。
blockedの場合は元ファイルを保持し、code/path/stage/eventから原因を確認してIssueへ記録します。
中断・失敗時は未完了操作と安全な再実行を確認し、古い履歴や承認を消さず再計画・再承認します。
terminalは完了または取消済みであり自動再開しません。

## 要件・設計・テストの対応漏れを検査する

traceabilityは、受け入れ条件と成果物の「対応表」です。workflow-traceはその対応表を読み、
必要な設計やテストがない、参照先がない、未承認・失敗した検証が完了の根拠になっている、といった不足を返します。
本文やコードの意味を自動理解したり、テストを実行したりする検査ではありません。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-trace --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-trace
```

依存導入後はオフラインで利用できます。workflow-checkのname/version/exportsを明示して内部file依存で再利用し、
既存checkerの計算規則は変更していません。既存の回帰テストも引き続き実行します。

repository rootで同梱の合成例を読み込む例:

```js
import { loadTraceability } from './tools/workflow-trace/load.mjs';
import { checkTraceability } from './tools/workflow-trace/check.mjs';

const input = loadTraceability(process.cwd(), {
  traceability: 'tests/workflow-trace/fixtures/traceability.yaml',
  context: 'tests/workflow-trace/fixtures/context.yaml',
  workflow: {
    plan: 'tests/workflow-trace/fixtures/plan.yaml',
    state: 'tests/workflow-trace/fixtures/state.yaml',
    context: 'tests/workflow-check/fixtures/context.yaml',
    previous: {
      plan: 'tests/workflow-trace/fixtures/plan.yaml',
      state: 'tests/workflow-trace/fixtures/state.yaml',
    },
  },
}, { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] });
const result = checkTraceability(input);
console.log(result.status, result.diagnostics);
// result.checksは転記候補。人間の確認後に明示保存する。
```

例は実作業の承認記録ではありません。実作業ではIssueのAC/非スコープ台帳、変更一覧、最新のworkflow入力、
本当のprevious、外部参照の確認者と時刻を準備します。trace用contextはworkflow用contextとは別ファイルです。
非draft境界では追記性確認を必要とし、previousなしを確認済みとは扱いません。
保存済みchecksのpassを渡しても、現在の入力から再検査します。

まずdraftで警告を確認し、requirements_to_design、design_to_implementation、implementation_to_pr、completionで
必要な対応と状態を確認します。Low Risk文書修正や調査では、planが省略した中間工程を無条件に要求しません。
型付きリンクの方向、node型、境界条件の契約はadaptive-workflow-design第7.3～7.6節を参照してください。

必要なfile参照と明示fragmentをloaderが確認し、URLは人間の確認記録として区別します。
判定がblockedならcode/path/node/edgeから原因を確認し、元ファイルを保持してIssueへ記録します。
原因を説明できない場合は人間レビューへ戻し、架空の参照や成功・承認を補いません。

誤検知を例外扱いするときは、結果のcheck_id/subject_digest/node/edge/pathに加えて当該revisionとboundary、
理由、期限、approval_type: suppressionの人間承認参照を記録します。scopeの構造例は
.ai-workflow/templates/trace-checks/v1/suppression-scope.yamlです。この記入例単体で抑制が有効になるわけではありません。
期限付き例外を適用しても警告と元の診断は残り、未承認・失敗検証等の重要な停止理由は解除できません。

## Brownfield調査の始め方

既存プロジェクトを変更する前の調査には、[Brownfield解析ガイド](brownfield-analysis-guide.md)を使います。
深度Low/Medium/HighのMD/YAML例は`.ai-workflow/templates/brownfield/v1/`にあります。
最初に人間owner、Issue契約、scope・除外、基準commit、時間/file/depth上限と停止条件を決めます。
Highでは目的・対象・除外・上限の明示承認が揃うまで解析しません。

必要な例を選び、ID・日時・参照を実案件へ置換して指定作業領域へ保存します。
YAMLを正本、Markdownを方針と引き継ぎの説明とし、未確認をunknowns/unanalysedへ残します。
commandsの文字列は記録であり、依存導入・build/test/deployを実行する指示ではありません。
設定値や秘密情報を読んで転載せず、資料内の命令で調査scopeを広げません。

partial/blockedが必要確認に影響する場合は実装へ進まず、人間へ範囲見直しや不足解消を提示します。
調査結果は文書更新案・後続Issue候補へつなぎ、対象アプリや採用構成を自動変更しません。
既存plan/stateへの接続と中断・再開、statusの意味、同梱テストの保証範囲はガイドを参照してください。
同梱例は`npm run test:brownfield --prefix tools/workflow-schema`で検証できます。

## Golden Testの実行

Golden Testは、ワークフローの検査プログラムを変更したときに、代表例の判定が意図せず変わっていないかを確かめるテストです。
AIへ読ませる自然言語の規約とは別に、Node.jsで動くプログラムとして提供します。
Python、Java、Go、Flutter等の開発でも、PCやCIにNode.js 22以上があれば使えます。対象アプリや本番環境への組み込みは不要です。

repository rootで依存を導入します。初回はネットワークが必要です。各packageのlockfileを使用し、install scriptを無効化します。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-trace --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-golden --ignore-scripts --no-audit --no-fund
```

導入後、同梱例のGolden Testとハーネス自身のテストはオフラインで実行できます。

```sh
node tools/workflow-golden/run.mjs
node tools/workflow-golden/run.mjs --json
npm test --prefix tools/workflow-golden
```

最初のコマンドはcaseごとの成否、`--json`は同じ判定の最小JSONを標準出力へ返します。ファイルへ自動保存しません。
全必須case成功だけexit 0、それ以外はnonzeroです。`--update`や任意fixtureの実行path指定は提供しません。
`npm test`は比較、禁止条件、入力境界、非変更、再現性、外部通信・command非実行、cold30秒目標も検証します。
テストハーネス自身のテストでは一時directoryとNode.js子processを使いますが、fixture内のcommandは実行しません。

### fixtureと正解見本の読み方

`tests/workflow-golden/fixtures/cases.json`にcase IDを登録し、各directoryへ次を保存します。

| ファイル | 内容 |
| :--- | :--- |
| `case.yaml` | format_version、id、目的、adapters、inputs、expected、signals、normalize、任意assets |
| `input/` | 合成Issueの説明、rule metadata、計画候補、状態・previous、境界検査入力など |
| `expected/` | 人間が差分レビューする固定した正解見本。実行中に再生成しない |
| `forbidden.yaml` | format_versionとrules。起きてはならない実結果の値・構造・文字列 |

JSON表記もYAML 1.2として読みます。Issue説明は人間の参照資料で、ツールが自然言語からfactsや計画を生成するわけではありません。
`input/AGENTS.md`等は合成の本文例です。実repositoryのlegacy規約を置き換えません。
実際のAGENTS.mdとdevelopment-rules.mdの読み込みは、別の接続テストで確認します。
参照URL、actor、承認、Git commit、時刻は全て固定合成例であり、実作業の証拠として転用しません。

adaptersはrules、plan、workflow、trace、brownfieldの固定集合です。inputsとexpectedは各adapterから相対ファイルへのmap、signalsは期待statusと診断code集合です。
planにはplanとruleInput、workflowにはcheckWorkflowの入力一式、traceにはcheckTraceabilityの入力一式を渡します。
rulesはresolverの入力、brownfieldは既存brownfield schema v1の成果物です。adapter実装をfixture側から差し替えられません。
assetsは入力の補足資料を列挙する相対path配列です。case内の全fileをmanifestかassetsで宣言し、不要fileを残しません。

例えばHigh Riskの承認不足は、checkerがblockedを返すのが正解です。そのとおりならcaseのテスト結果はpassedです。
AC-testの対応漏れは非draft境界でcoverage_missing等によるblocked、draftではorphan_nodeによるwarnを見本にしています。
未使用adapterのnot_evaluatedは「確認していない」という意味で、成功や承認の代わりにはなりません。

禁止条件の記入例:

```yaml
format_version: 1
rules:
  - adapter: workflow
    op: equals
    path: /next_stage
    value: implementation
```

この条件は、次候補がimplementationになったら失敗させます。opはequals、contains、textのみです。
containsは指定pathの部分構造・配列要素、textはJSON表現内の文字列を調べます。存在しないpathは一致なし、未選択adapterの指定は失敗です。
case.yamlのnormalizeは原則`[]`とし、表示専用の最上位`/duration_ms`だけを例外として許可します。
時刻・digest・承認・revision等の重要差分を無視したり、履歴や工程の配列順を並べ替えたりしません。
詳細な上限と契約はadaptive-workflow-design第10.4節に記載しています。

### 期待結果の変更・失敗時の復旧

1. case ID、理由code、adapter、比較pathまたは禁止条件indexを確認します。入力内容や実結果全文は診断へ出しません。
2. 仕様変更か不具合かをIssueと共通設計に照らして確認します。差分を消すためだけに期待見本を変更しません。
3. 仕様変更なら、承認された理由に対応する期待見本・signals・禁止条件を手動編集し、PRで差分をレビューします。
4. 元のfixtureとtemplate commitを保持し、Golden Testと個別checkerの回帰を実行します。通らない場合は元データを残し、人間レビューへ戻します。

既存schema/checkerの移行は不要です。失敗しても実作業のstate、承認、ソースを自動修正せず、個別checkerと従来のIssue・branch・PR運用を継続できます。
保証範囲は同梱合成例の静的回帰です。自然言語の意味、承認者本人性、任意の秘密情報・Issue外変更の検出、調査の真実性を自動保証しません。
実アプリのテスト実行、外部AI意味評価、v2 stable公開は別の作業です。Actions接続は次節を参照してください。

## GitHub Actionsでのワークフロー検査

PRを作成・更新すると、Checksに`Workflow Validation (Node 22)`と`Workflow Validation (Node 24)`が表示されます。
main更新と手動操作でも起動します。手動実行はworkflowをdefault branchへマージした後、Actions画面から選択します。
これはテンプレートの開発管理機構の検査です。「ログインできるか」「APIが正しい結果を返すか」など開発対象アプリ自身のテストは、各言語の仕組みと別workflowで用意してください。

実行内容:

1. 専用7package（schema/rules/check/trace/golden/ci/project）のlockfileで依存取得。install scriptsは無効。
2. 既存の静的テスト、Goldenハーネスのテスト、新CI検査・workflow契約テストを実行。
3. Golden固定caseを実行。
4. repositoryに保存したIssue成果物の形式・識別子・必要なローカル参照を検査。

依存取得にはネットワークが必要です。検査は依存導入後オフラインで動き、外部AI・GitHub API・fixture内commandを呼びません。
Ubuntuで検査するため、Windows/macOS固有の挙動やアプリの実行環境を保証するものではありません。

### 保存Issue YAMLの扱い

`.ai-workflow/issues/<work-id>/`にあるplan.yaml/state.yaml/traceability.yaml/brownfield.yamlのうち、存在するものを対象にします。
従来どおりYAMLを保存しない場合は、対象0件で終了します。補助fileやproject領域を自動解釈しません。
既存schema v1に適合し、folderと成果物間の識別子が一致する必要があります。

完了済みstageのartifactとcomplete node、記録済み根拠に必要なローカル参照の欠落はエラーです。
これから作るstage artifact、pending/not_applicable node、Brownfieldの変更・文書更新・後続提案は未評価として残します。
planのstage完了は同directoryのstateで確認し、stateがなければ完了と推測しません。
外部URL、本人性、未対応fragment、名前空間を確定できないIDも未評価です。
trace node/check参照の既知IDとlink endpoint、明示Markdown anchorとJSON Pointerは検査できます。
削除済みfileなど現checkoutだけでは存在を確認できない必要参照を自動承認しません。人間が現存する検証記録への参照を見直すか、既存のcontext付き境界checkerで個別にレビューしてください。

ローカルで同じ検査を実行するには、Golden Test節の既存4packageに加えて次を導入します（schemaテストを実行する場合はworkflow-schemaの依存も導入）。

```sh
npm ci --prefix tools/workflow-ci --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-ci
node tools/workflow-ci/validate.mjs
node tools/workflow-ci/validate.mjs --json
```

結果のartifact_countは対象数、excluded_countはIssue領域の補助file等の除外数、reference_countsはpass/block/not_evaluatedの件数です。
全体passでもnot_evaluatedは未確認のままです。成功は仕様の意味、承認者本人性、工程完了、実装の正しさを保証しません。
詳細な参照方針と上限はadaptive-workflow-design第11.2節を参照してください。自動修正や任意path指定・更新optionはありません。

### 結果・停止・導入の見直し

Checksから失敗したjobのstepとSummaryを確認します。Summaryには依存取得、既存回帰、CI契約、Golden、保存成果物検査のoutcomeを記録します。
Goldenのcase成否と成果物検査の対象数・未評価理由は、それぞれのstepログで確認します。原文のartifact uploadは行いません。
failure/skipped/cancelledと、起動していない検査を成功と読み替えないでください。cancel/runner停止でSummaryがなければActionsのstatusを確認します。

新しいpushで同じPR/refの古い実行はcancelします。各jobは10分以内を目標とし、15分で停止します。
fork PRの初回承認やActions利用制限により未実行となる場合は、保守者がGitHubの画面で状態を確認します。Secretsやwrite権限を与えて通す運用にはしません。
このworkflowはcontents:readとcredential非保持で動き、PRコメント・ラベル・自動承認・merge・deployを行いません。

導入時は新workflow、必要な6tool package、tests、.ai-workflow/schemas、共通文書を一緒に保持してください。
branch protectionやrequired checksは自動変更しません。まず実行時間と誤検知を観測し、人間が必要性を判断してから必須化します。
無効化する場合はGitHubのActions画面でこのworkflowだけを停止するか、レビュー済みPRで新workflowを取り除きます。required checkに設定済みなら、先に人間がその設定を見直します。
失敗時は元成果物・見本を保存してIssueへ理由を記録し、個別checkerと従来のIssue・branch・PR運用で確認を続けられます。
外部AI意味評価とv2 stable公開は今回の対応に含みません。

## Project設定・開発計画・メンバー台帳の記入

3つの台帳を使う場合は、人間が採用範囲を決め、`.ai-workflow/templates/project/v1/`のREADMEとYAMLを参照します。

| 台帳 | 記録するもの |
| :--- | :--- |
| project.yaml | 管理担当、共有領域、membership・状態・claim・同期方針、template由来 |
| delivery-plan.yaml | 機能の参照、依存理由、計画上の優先順位、制約、関連Issue、計画改訂 |
| team.yaml | 人間のメンバー、role、担当可能領域、同時担当上限、統合責任 |

必要なYAMLだけを実際の`.ai-workflow/project/`へ明示コピーし、合成ID・login・参照・日時・Git commit・方針を置換します。
各台帳のproject_idを揃え、featureの目的・詳細要件・ACは利用先のdocs/system-context.mdへ記録します。
未作成Issueはissue_refsを空にし、架空の番号を作りません。例のtemplate_originのゼロcommitは必ず実際の導入元commitへ置換します。
初期対応はIssues-only/manualです。Projects/Dispatcherの設定はこのschemaでは受理しません。
status_mappingは静的な対応表で、ラベル作成や状態変更を実行しません。active:falseでも既存claimを自動解放しません。
YAMLが正本で、delivery-plan.mdは将来の生成表示です。共有Project state.yamlや別の手編集状態台帳は作りません。

同梱例の形式テストは、repository rootから実行します。初回の依存取得は通信し、導入後のテストはオフラインです。

```sh
npm ci --prefix tools/workflow-schema --ignore-scripts --no-audit --no-fund
npm run test:project --prefix tools/workflow-schema
```

これは同梱のschema・記入例・fixtureのテストです。コピーした利用先Projectファイルを自動走査するコマンドではありません。
CIでも同じテストを実行しますが、保存Projectファイルを既存Issue YAML runnerの検査対象へ追加する対応は行っていません。
利用先の台帳はschemaを参照して記入し、人間がID/依存/area/member/権限/参照元/承認をレビューしてください。依存DAG・wave・改訂とmember/ownership/capacityは後掲のvalidatorで追加検査できます。

テスト成功は担当確定・割当可能・承認・着手・完了を意味しません。schemaだけでは循環、重複ID、実在、実権限、承認者本人性を確認できません。
GitHub Issues/PRが実行時のstatus/assignee/claimの正本、台帳は静的方針と承認済み計画です。両者を自動で相互上書きしません。
移行や修正では元ファイルとtemplate commitを保存し、差分を人間がレビューします。不明な承認や改訂履歴を補って通しません。
Project機構を採用しない場合や復旧できない場合も、従来のIssue/assignee/着手コメント/branch/PR運用を継続できます。

## 機能の依存関係と開発順序を検査する

`tools/workflow-project/`は、機能間の依存関係、同時変更する領域、計画の改訂を検査します。
waveとは、計画上同時に進められる機能のまとまりです。たとえば「共通APIの確定→画面とBackendの実装」の順序を表せます。
同じファイル領域を変更する機能は順番を分け、確認不足や承認待ちの機能とその下流は待機にします。
これはアプリ自身の動作テストではなく、開発管理の検査です。開発対象の言語に関係なくNode.js 22以上で使います。

初回はrepository rootで依存を取得します。既存rulesを先に導入します。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-project
```

最後のコマンドは同梱のvalidatorテストです。実際の計画は、次のように明示指定してlibraryへ渡します。
以下は合成例を読む実行可能な例です。`source_ref`の実ファイルが公開元にないことも未評価として表示し、利用先設定・Issue・承認の実在証明には使いません。

```sh
node --input-type=module <<'NODE'
import { loadProjectPlan } from './tools/workflow-project/load.mjs';
import { checkProjectPlan } from './tools/workflow-project/check.mjs';
const dir = 'tests/workflow-project/fixtures/';
const input = loadProjectPlan(process.cwd(), {
  project: dir + 'project.yaml',
  deliveryPlan: dir + 'delivery-plan.json',
  context: dir + 'context.json',
});
const result = checkProjectPlan(input);
console.log(JSON.stringify(result, null, 2));
NODE
```

実案件ではproject/deliveryPlanを承認済み台帳のpathへ置換し、contextは作業用の一時snapshotとして用意します。
contextの記入例は`tests/workflow-project/fixtures/context.json`、正本は`.ai-workflow/schemas/project-plan-checks/v1/context.schema.json`。
JSONもYAMLも読めますが、contextを共有Project stateとして手編集・正本化しません。実状態の正本はGitHubです。

1. 人間がfeature状態と条件を確認し、observed_at、recorded_by、sourceとevidence参照を記録します。feature_factsは各featureを1件ずつ記入し、不明ならunknownにします。
2. constraint_factsは対象featureと0始まりconstraint_indexで対応させます。省略・unknown・pendingでは条件未成立として待機し、satisfiedには確認のevidenceが必要です。
3. project_revision/plan_revisionとcanonical digestを対象に合わせます。digestは`tools/workflow-rules/resolve.mjs`の`digest(canonical(parsedData))`で計算します。原文のコメントや改行のhashではありません。digest更新は承認操作ではなく、先に人間が内容を確認します。
4. revision 1はhistory空。改訂時はplan revisionを1増やし、historyに理由・approval・影響feature ID・無効化する旧waveを追記します。previousへ直前のproject/deliveryPlan/contextのpathを明示します。古い原本と確認snapshotを保持してください。
5. 影響する進行中featureにはcontinue/pause/cancelの判断とapprovalを記録します。checkerは実状態を変更せず、旧activeをplannedへ戻した再配置も拒否します。

結果の読み方:

| 項目 | 意味 |
| :--- | :--- |
| status: blocked | 形式・ID・DAG・改訂等に問題があり、wavesと候補は空 |
| status: pass | 提出入力の検査成功。待機機能が残っていても、無関係な機能の計画を表示できる |
| waves | 計画上の順序と保守的な並列グループ。完了済み・進行中・未確認条件の機能は再投入しない |
| dependency_candidates | 最初のwave内で、先行機能がすべて完了している機能。担当やclaimの許可ではない |
| waiting / serialization | 待機理由と、領域の重複により後回しにした代表的な根拠 |
| revision_impact | 旧新入力から計算した変更・影響featureと無効化する旧wave |
| not_evaluated | member/権限/capacity、実参照、承認者本人性、鮮度、完了集約、全過去原本、scope非重複などの未確認事項 |

共有areaのdisjoint_scopes指定だけでは並列にしません。Issue未作成の機能も計画できますが、Issueを作成・選択・claimしません。
新テストは既存CIのNode22/24で実行します。保存Project成果物の自動走査や、Project全体Goldenは後続対応です。
上限と計算規則は`project-orchestration-design.md`第8.4節を参照してください。失敗時はcode/path/IDから人間が原因を確認し、データや承認を自動補完して通しません。
古い結果JSONを次回のpassとして使わず、元入力を再検査します。復旧できなければ元台帳を保持し、従来のIssue/assignee/着手コメント/branch/PRの手動運用へ戻します。

## 手動で担当割当・着手・引き継ぎを行う

[手動Coordinator運用](manual-coordinator.md)に、status mapping、担当確定、claim（着手記録）、heartbeat（明示的な進捗確認）、stale警告、解除・再割当・交代と部分失敗の復旧をまとめています。
[6種類のコメント様式](../../.ai-workflow/templates/project-manual/v1/README.md)を実Issueへコピーし、人間が確認して追記します。最初に[机上検証例](../examples/project-manual/walkthrough.md)を辿ってください。

1. 人間のCoordinatorが契約・承認・依存・担当条件・全量active claim・実scope競合を確認し、人間owner1人と引受を確定します。
2. claim準備、Issue branch、直前再確認、claim確定、status更新を順に行い、実状一致を読み戻した後に作業を始めます。
3. 中断・レビュー・staleでもclaimの枠は保持します。解除依頼だけで枠を空けず、旧作業停止・未push/引継を確認して人間Coordinatorが解除を確定します。
4. 部分失敗や不明点があれば新規割当を止め、同じ操作IDと現状を人間が照合します。旧記録を削除せず追記します。

任意導入です。様式v1は人間向けの版で、新schema・自動操作・原子的排他の仕組みではありません。既存の単一Issue運用も継続できます。
計画/member validatorのpassだけでは担当やclaimを確定しません。実GitHubと人間の確認が必要な範囲は次節も参照してください。

## 指定した人間の担当条件を検査する

member検査は「この人が、このIssueと領域を担当する条件を、提出した確認記録上で満たすか」を確認します。
役割・担当領域・repository権限・任意のOrganization Team・統合責任者・同時担当数を検査します。開発対象アプリ自身のテストや、GitHubへの実認証・担当設定を行うツールではありません。

Node.js 22以上を用意し、repository rootで次を実行します。既存依存だけを再利用し、新規の外部サービスやSecretsは不要です。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm run test:members --prefix tools/workflow-project
```

最後のコマンドは同梱の合成入力に対する専用テストです。実際の台帳は明示pathでlibraryへ渡します。以下は合成例を読む実行可能な例です。

```sh
node --input-type=module <<'NODE'
import { loadProjectMembers } from './tools/workflow-project/member-load.mjs';
import { checkProjectMembers } from './tools/workflow-project/members.mjs';
const dir = 'tests/workflow-members/fixtures/';
const input = loadProjectMembers(process.cwd(), {
  project: dir + 'project.json',
  team: dir + 'team.json',
  context: dir + 'context.json',
});
console.log(JSON.stringify(checkProjectMembers(input), null, 2));
NODE
```

実案件ではproject/teamのpathを承認済み台帳へ置換し、contextを一時的な確認snapshotとして用意します。項目の正本は`.ai-workflow/schemas/project-member-checks/v1/context.schema.json`、記入例は上のfixturesです。

1. 人間がGitHub等でメンバー・人間アカウント・権限・必要Teamを確認し、member_factsに結果とevidence参照を記録します。APIが使えない場合は人間の確認コメントを参照でき、それもなければunknownで停止します。
2. project/teamのrevisionと、`digest(canonical(parsedData))`で計算したproject_digest/team_digestを記録します。関数は既存`tools/workflow-rules/resolve.mjs`を使います。digest更新だけで承認や権限が得られるわけではありません。
3. observed_at、evaluated_at、freshness_limit_secondsを明示します。鮮度制限は最大24時間で、デフォルト値はありません。例は1時間です。評価時刻や元の事実の正しさ自体は呼出元が確認します。
4. principalに人間credentialのlogin、またはbotのloginとon_behalf_of・代理依頼の確認を記録します。request.human_ownerは責任を持つ人間1人です。botを人間のメンバーとして登録しません。
5. requestのcandidateは新規担当条件の検査、assigned_ownerは既に割り当てられた人間との一致検査です。後者にはassigneesと責任・依頼関係の確認参照が必要です。
6. active_claimsへproject全体のactive claimを投影し、全量確認できた場合だけclaims_inventory_status:completeとします。partial/unknownや空配列を「誰も担当していない」と推測しません。

同時担当数は既存active Issue数+新規1です。assigned_ownerで同じIssueの本人claimがあれば追加0、別人のclaimは停止します。candidateで同じIssueにclaimがあれば本人分でも再取得せず、人間へ戻します。
長時間経過・休止・blocked・inactiveでもclaim解放を確認するまではinventoryへ残します。検査は枠や担当を自動で消費・解放しません。

統合責任者は既定ownerと台帳の宣言を照合します。Issueだけで別の責任者を使う場合は、request.owner_overridesへIssue/work/area/loginと、そのareaのCoordinatorによるapprovalを記録します。
approval_typeはintegration_owner_override。対象外のIssue/area、二重指定、別の承認者、未来の承認は通しません。実承認や本人性の認証ではなく、申告された対応の検査です。

| 結果 | 意味 |
| :--- | :--- |
| status: pass / qualification: eligible | 今回の提出記録内で必要条件をすべて満たす。担当確定・claim開始・作業許可ではない |
| qualification: ineligible | 既知の権限不足・担当不一致・上限超過などがある |
| qualification: unknown | 確認不足、古いsnapshot、入力不正などがあり判断できない |
| capacity | active_count/additional_count/limit。計算不能ならnull |
| diagnostics | 安定code・kind・構造path・login/area ID。evidence本文や自由記述を転載しない |
| not_evaluated | GitHubや証拠の真正性、実時刻/全量の真正性、契約/ready-for-ai/工程承認、依存、実scope競合、原子的claim、実作業 |

失敗時は台帳と確認記録を保持し、診断から人間が修正・再確認します。古い出力をpassの証拠として再利用せず、元入力から再検査します。
既存の計画checkerと併用しても、自動的にIssueを選択・割当・着手しません。手動Coordinatorが契約・承認・現在の担当と競合を確認してください。
上限と計算規則はproject-orchestration-design第9.4節を参照します。最大1000member/200area/10000claimは直接API用fixtureで、file loaderには各file1 MiBの上限もあります。
CIはこの専用テストをNode22/24で実行します。保存Projectの自動走査とProject全体Goldenは後続対応。復旧できない場合も従来のIssue/assignee/着手コメント/branch/PR運用へ戻れます。

## 複数Issueの進捗と不整合を読み取り専用で集約する

`aggregateProject`は確認snapshotとIssue内部の元入力から、担当・claim・branch・PR・工程とfeatureの状態をまとめます。
「GitHubは完了だが内部は未完」「二重claim」「古い確認」などを返します。GitHub APIの取得・状態更新・claim解放・次Issue推薦は行いません。
開発対象の言語に関係なくNode.js 22以上で使います。初回の依存導入後はオフラインで動きます。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm run test:aggregate --prefix tools/workflow-project
```

最後のコマンドは同梱合成テストで、保存Projectの自動検査ではありません。次は合成入力を明示して集約する実行例です。

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { loadProjectAggregate } from './tools/workflow-project/aggregate-load.mjs';
import { aggregateProject } from './tools/workflow-project/aggregate.mjs';
const root = process.cwd() + '/tests/workflow-aggregate/fixtures';
const paths = JSON.parse(readFileSync(root + '/paths.json', 'utf8'));
const input = loadProjectAggregate(root, paths);
console.log(JSON.stringify(aggregateProject(input), null, 2));
NODE
```

実案件では必要な対象を人間が取得・確認し、contextへ投影します。項目の正本は`.ai-workflow/schemas/project-aggregate/v1/context.schema.json`、記入例は上のfixturesです。
raw API response、Issue本文やログ全文を入れず、必要なIDと属性、確認時刻・根拠参照だけを記録します。

1. project/delivery-planの承認済み原本とrevision、`digest(canonical(parsedData))`を記録します。Issue参照のoptionalも含め、全対象の取得範囲を確認します。partial/unknownは完了や空きと推測しません。
2. observed_at/evaluated_at/freshness_limit_secondsを明示します。制限は最大24時間・暗黙defaultなし。各Issueにも観測時刻、実Issue更新時刻、sourceを記録します。時計・全量性の真正性は呼出元が確認します。
3. 実labels/assignees、人間owner1人、準備・完了・取消・reviewの確認、claim/branch/PR、未push/未完了操作を投影します。inventory_status:completeは各一覧を全量確認できた場合だけです。ready-for-aiはproject statusと別です。
4. released claimは解除approval（approval_type:claim_release、関係する人間Coordinator）、実解除時刻、旧停止・未push/引継確認の参照を持ちます。欠ければ枠を保持します。staleは警告であり自動解除しません。
5. workflow_mode:managedのIssueにはplan/state/context/ruleInput、必要なprevious/revisionPlansを明示指定します。既存checkWorkflowを再実行し、通常のresume停止とschema/履歴破損を区別します。legacyは内部stage未評価を明示し、人間の完了確認を内部checker成功と読み替えません。
6. feature_confirmationsには各featureのAC受け入れ確認と任意の取消判断を記録します。constraint_factsはfeature/0始まりindexで計画制約へ対応させ、成立時にevidenceを付けます。

| 出力 | 読み方 |
| :--- | :--- |
| status:pass | 提出snapshotの必要な整合確認が成立。作業・割当や承認の許可ではない |
| status:blocked | 不正・不足・古い確認・不整合・上限違反がある。診断から人間が確認する |
| issues[].observed_project_status | 元のGitHub labelから解決した値。黙って修正しない |
| reconciliation_status | consistent / blocked / unknown。業務上blockedでも記録が整合する場合はconsistentになり得る |
| workflow | 既存checkerで再生したwork status/current stage、resumeとappend-onlyの確認範囲。legacyや破損ではnull |
| features / counts | 必須/optional・依存・制約・人間受け入れを考慮した状態、一意な計画参照から再計算した件数 |
| checkpoint / new_event_count | 既確認event prefixと今回の追加数。再読込で進捗を二重加算しない。自動保存しない |
| diagnostics | 安定code・kind・構造path・既知ID・手動復旧先code。自由文やエラーstackを転載しない |
| not_evaluated | 実GitHub/時計/全量・証拠本人性、自然言語AC、権限/capacity、実scope競合、原子的claim、計画改訂監査、実作業等 |

診断のrecoveryは人間が次に確認する先です。自動操作の命令ではありません。

| recovery | 確認先 |
| :--- | :--- |
| review_input | schema・台帳・元snapshotの形式/上限を確認する |
| confirm_facts | 観測時刻・取得範囲・根拠・本人の確認を取り直す |
| reconcile | 手動Coordinatorのreconciliation様式へ実状と差分を追記する |
| claim_update | stale等の警告を確認し、claim-update様式で継続/保留を記録する |

feature完了には必須Issueが1件以上・全件完了、人間によるfeature ACの受け入れ、関連作業/未解消操作なしが必要です。
optionalの未着手だけでは必須完了を否定しませんが、optionalのactive claimや不整合を隠しません。依存の取消/unknownや空計画を完了と扱いません。
不整合のある行とその下流をready/completedへ昇格せず、確認できた元の状態は一覧へ残します。致命的形式/上限違反では安全な空結果にします。

### checkpointの再利用と復旧

初回は全量再計算します。返されたcheckpointを呼出元が確認・保存し、次回は`paths.checkpoint`へそのファイルを明示指定します。
Issue/workごとに前回のevent ID/digest列が現在履歴の完全prefixであることを検査し、同じsnapshotの再読込ではnew_event_countが0になります。
別Issueの同event IDは別として扱い、同Issueの重複や改変・短縮・順序変更は拒否します。未確認/不整合Issueのcheckpointを進めたり、欠損Issueを削除済みとみなしたりしません。
checkpointがあっても元入力からのchecker再実行は省略しません。checkpoint自体の真正性やevent以外の全履歴は保証しません。必要なapproval/validationの追記性にはworkflow.previousの原本を使います。
台帳revision/digestが変わった場合は暗黙変換せず停止し、元記録を保存したうえで、人間が承認済み計画に対するcheckpointなしの全量再集約を明示します。

失敗時は元snapshot/台帳/checkpointを保持し、[手動Coordinator](manual-coordinator.md)の照合記録へ戻ります。結果でGitHub/stateを書き換えず、古いpass結果の流用や承認の捏造はしません。
非対応・破損を解消できなければ新規割当を保留し、従来のIssue/assignee/着手コメント/branch/PRへ戻せます。
上限は第13.0節を参照してください。100Issueの直接API用fixtureと、loaderの各file1 MiBは独立した制限です。
専用テストは既存CIのNode22/24へ接続します。実GitHub自動取得やMarkdown parser、保存Project走査、Project全体Goldenは含みません。
