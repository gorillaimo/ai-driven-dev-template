# Adaptive AI Development Workflow Design

このドキュメントは、AI駆動開発ワークフローを適応的かつ再開可能にするための共通設計を定義する。Issue契約を中心とする既存運用を置き換えるものではなく、実行計画、状態、追跡性、ルール、Brownfield解析、Golden Testの共通境界を追加する。

## 1. 文書の状態

- 状態: 設計承認済み（Issue #8、2026-08-06）
- 承認記録: https://github.com/gorillaimo/ai-driven-dev-template/issues/8#issuecomment-5206128174
- 適用開始: 後続実装Issueが完了し、この文書の各機構が有効化された時点
- 現時点の扱い: Issue成果物のschema v1、YAMLテンプレート、同梱例のオフライン形式テスト、およびモジュール式ルールのmetadata・オフライン解決libraryを提供する。plan/stateの工程・履歴・再開候補を検査する静的checkerも提供する。フェーズ境界の追跡性checkerも提供する。Brownfieldの読み取り専用手順と深度別テンプレートも提供する。CLI、GitHub Actions統合は未実装
- 互換性方針: 既存利用者を壊さない追加方式とし、従来のIssueベース運用だけでも開発を継続できること

設計承認前は、この文書を根拠として実装へ進んではならない。設計承認後も、対応する後続実装Issueの契約、assignee、`ready-for-ai`、変更リスクに応じた人間承認を確認してから着手する。初期リリースは共通仕様、テンプレート、オフライン静的チェック、GitHub Actionsを対象とし、統合CLIは利用実績を確認してから別Issueで判断する。

## 2. 目的と非目的

### 目的

- Issueの規模、変更リスク、既存資産、変更領域に応じて必要な工程だけを明示的に選択する。
- AIや人間が中断後に、推測せず同じ作業状態から再開できるようにする。
- 要件、設計、API、Quality Gates、テスト、実装の対応漏れをフェーズ境界で検出する。
- 必須ルールと案件固有ルールを分離し、競合時の優先順位を決定可能にする。
- 既存プロジェクトへの導入前に、変更を伴わないBrownfield解析を行う。
- ワークフロー定義そのものの変更を再現可能なGolden Testで検証する。

### 非目的

- 本設計だけを根拠に、AIが担当Issueを自動選択・claim・着手すること。プロジェクト側から割り当てられたIssue内での次ステージ提案とは区別する。
- AIによる自動承認、仕様決定を許可すること。
- Issue、assignee、`ready-for-ai`、変更リスク分類、Quality Gatesを置き換えること。
- すべての工程を常に実行すること。
- 初期リリースで特定のAIベンダーや統合CLIへ依存すること。
- リポジトリのシークレット、個人情報、本番データをAI評価へ送信すること。

### 現行テンプレート、AI-DLC 2.0、採用設計の差分

| 観点 | 現行テンプレート | AI-DLC 2.0で参考にする考え方 | この設計で採用する範囲 |
| :--- | :--- | :--- | :--- |
| ガバナンス | Issue、assignee、`ready-for-ai`、リスク、PR、人間承認が中心 | フェーズとステージを実行単位にする | 現行ガバナンスを外側に維持する |
| 工程選択 | 規約と人間のプロンプトで調整する | scopeとdepthに応じて工程を適応させる | 軽量な標準ステージと理由付きskipを使う |
| 実行状態 | Issueコメントや会話へ分散する | ワークフロー状態を明示する | Issue単位のplan/state YAMLへ最小限を保存する |
| 成果物検査 | 人間のレビューが中心 | ステージ間で成果物を確認する | IDベースの静的追跡性検査を追加する |
| 既存資産 | 調査Issueの運用手順がある | Brownfieldの解析深度を調整する | 読み取り専用成果物とLow/Medium/High深度を定義する |
| 品質回帰 | アプリやActionsの個別テストが中心 | ワークフローの振る舞いを評価する | 合成fixtureによるオフラインGolden Testを必須にする |
| AIの役割 | Issue契約内で提案・実装する | 複数の専門エージェントで工程を支援する | 特定のエージェント数・モデル・ツールへ固定しない |

AI-DLC 2.0への完全移行、多数のステージや専門エージェント構成の複製、完全自律承認、全会話ログの保存は取り込まない。採用するのは6機構の境界と検証可能性であり、既存テンプレートの軽さと人間主導の契約を維持する。

## 3. 既存運用との境界

### 3.1 優先順位

判断が競合する場合は、以下の順に優先する。

1. 人間の明示指示、承認、停止指示
2. 対応Issueの本文、受け入れ条件、非スコープ
3. `AGENTS.md` と必須の共通ルール
4. 条件付きルール
5. opt-inルール
6. AIが生成した実行計画

下位のルールや計画は、上位の契約を緩和できない。人間の停止指示は即時に優先し、スコープを変える指示はIssue契約へ反映してから適用する。競合を自動解消できない場合は作業を停止し、`blocked`と理由を記録して人間へ確認する。

### 3.2 着手条件

実行計画を作成しても、以下の着手条件は変わらない。

- 対応Issueが存在し、目的、スコープ、非スコープ、受け入れ条件が確認できる。
- 人間のassigneeが設定されている。
- `ready-for-ai`がない場合は不足情報を確認する。
- 既存PR、着手コメント、他エージェントとの競合を確認する。
- High Riskまたは既存規約で承認が必要な変更は、人間の明示承認を得る。

### 3.3 Quality Gatesとの関係

適応的な実行計画はQuality Gatesを省略する仕組みではない。NFR、Security、Resiliencyの該当有無を計画時に判定し、該当するゲートを必須ステージにする。High Riskでは、該当なしの判断を含め、人間の承認前にテスト作成や実装へ進めない。

### 3.4 機構ごとの境界契約

| 機構 | 目的 | 主入力 | 主出力・状態 | 適用条件 | 承認点 | 失敗時動作 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 適応的な実行計画 | 必要な工程だけを根拠付きで選ぶ | Issue、リスク、文書、ルール | plan。`required/optional/skipped` | 全Issue | 必須工程の上書き、High Risk | 従来工程へ安全側にfallbackし、不明工程は省略しない |
| 状態管理と再開 | 推測なしで作業を継続する | plan、Git、Issue、検証・承認履歴 | state。作業・ステージ状態 | 計画成果物を利用する作業 | 失われた承認の復元、非冪等処理の再実行 | `blocked/failed`として停止し、復元案を提示する |
| 追跡性検査 | 工程間の対応漏れを検出する | AC、要件、設計、API、Gate、テスト、変更 | traceability。`warn/block/pass` | 各フェーズ境界 | 抑制、block解除 | 後続フェーズをblockし、不足リンクを報告する |
| モジュール式ルール | 適用ルールを決定可能にする | ルールmetadata、Issue、リスク、変更領域 | 解決済みルール。`selected/not_applicable/conflicted` | 全Issue | opt-in採用、解消不能な競合 | 上位ルールを維持し、未知条件・循環・競合はblockする |
| Brownfield解析 | 既存資産を変更前に理解する | 既存コード、文書、CI、対象Issue | brownfield。`complete/partial/blocked` | 初導入、構成不明、未知領域 | High深度、秘密・副作用・費用の可能性 | 調査を停止し、未解析範囲と安全な代替を報告する |
| Golden Test | ワークフロー変更の回帰を検出する | 合成fixture、期待・禁止結果 | テスト結果。`passed/failed/not_evaluated` | ワークフロー関連変更 | AI評価のopt-inと予算 | 静的差分は失敗、AI評価不能は未評価として分離する |

### 3.5 プロジェクトレベルの統制との境界

この設計は1つのIssueまたはwork item内部の工程を対象とする。複数feature / Issue / 開発者 / AIエージェントをまたぐ優先順位、依存グラフ、担当割当、claim、並列wave、共有ファイルの統合責任は`docs/common/project-orchestration-design.md`（Issue #9）で扱い、この設計へ混在させない。

将来のプロジェクト集約から参照できるよう、Issue単位の成果物は任意の`project_id`と`feature_id`、標準状態イベントを持てるようにする。これらの参照が未設定でも単一Issue運用はblockしない。`feature_id`の採番、開発順序、担当者の選択、自動割当はプロジェクト側の責務であり、本設計のplan/stateチェッカーが独自に決定しない。

状態の正本は責務ごとに分離する。

| 状態 | 正本 | Issue #8側の扱い |
| :--- | :--- | :--- |
| Issue契約、assignee、claim、PR | GitHub Issue / PR | 読み取り・参照し、独自に割当やclaimを変更しない |
| プロジェクト進捗 | GitHub Issues。採用時はGitHub Projectsを含む | Issue内部状態から投影できるが、プロジェクト側の値を独自に確定しない |
| Issue内部のステージ、再開地点、検証、承認参照 | `.ai-workflow/issues/<work-id>/state.yaml` | 再開と境界検査の正本として更新する |
| feature定義と`feature_id` | `docs/system-context.md` | 対象featureへの参照だけを保持する |
| プロジェクトの依存、wave、チーム、担当可能領域 | project orchestration成果物とGitHub | Issue内部成果物へ複製しない |

GitHub上の工程表示はIssue内部状態を集約した投影として扱う。GitHubと`state.yaml`に不整合がある場合、どちらかを自動上書きせず`blocked`として差分と更新時刻を提示し、project orchestrationで定義する同期・復旧手順へ委ねる。

## 4. 共通成果物

ワークフロー成果物は、IssueまたはGitHubを使わない場合の作業IDごとに配置する。

```text
.ai-workflow/
  project/               # project orchestrationが所有するプロジェクト統制用の予約領域
  rules/                 # プロジェクト固有・opt-inルール
    <rule-id>/
      rule.md
      rule.yaml
  issues/
    <work-id>/
      plan.md
      plan.yaml
      state.yaml
      traceability.yaml
      brownfield.md       # Brownfieldの場合のみ
      brownfield.yaml     # Brownfieldの場合のみ
```

- `plan.md`: 人間がレビューする実行方針、工程の採用理由、承認点。
- `plan.yaml`: チェッカーが読むステージ、適用条件、依存関係。
- `state.yaml`: 現在地、履歴、再開情報、ブロッカー。
- `traceability.yaml`: 契約項目と成果物の対応。
- `brownfield.md`: 既存構成の調査結果と人間向け要約。
- `brownfield.yaml`: 構成要素、コマンド、リスク、文書不足の機械可読表現。

`.ai-workflow/project/`は、機能台帳、依存グラフ、チーム台帳、集約方針のために予約する。配下のschemaや更新主体は`docs/common/project-orchestration-design.md`で定義し、Issue単位のチェッカーはこの領域を書き換えない。

MarkdownとYAMLは同じ事実を別々に管理しない。YAMLを構造化された正本、Markdownをレビュー用の説明とし、矛盾した場合は境界検査をblockにする。成果物には秘密情報、トークン、個人情報、本番データ、未マスクのログを含めない。

各YAMLは`schema_version`と`work_id`を持つ。GitHub Issueを利用する場合は`issue_ref`を必須とし、プロジェクト統制へ接続する場合だけ`project_id`と`feature_id`を追加する。プロジェクト参照は識別と集約に限定し、担当、優先順位、依存関係などプロジェクト側の実行時状態をIssue成果物へ複製しない。

初期実装では、成果物のコミットを一律必須にしない。複数環境で再開する場合は作業ブランチへ保存し、PR作成時の保持・削除方針はプロジェクトで選択する。ただし、検証結果と重要な承認履歴はIssueまたはPRへ残す。

### 4.1 実装済みのschema v1

JSON Schema Draft 2020-12を採用し、次の場所を正本とする。これは成果物の形式契約であり、工程を自動実行する機構ではない。

| 配置 | 内容 |
| :--- | :--- |
| `.ai-workflow/schemas/issue/v1/common.schema.json` | 共通識別子、参照、actor、承認、検証、イベント、共通ヘッダー |
| `.ai-workflow/schemas/issue/v1/plan.schema.json` | 工程選択、理由、判断者、依存、成果物、承認点、検証方法 |
| `.ai-workflow/schemas/issue/v1/state.schema.json` | 状態、Git参照、検証、承認、blocker、再開情報、履歴 |
| `.ai-workflow/schemas/issue/v1/traceability.schema.json` | typed node、ID間リンク、境界検査結果、期限付き抑制 |
| `.ai-workflow/schemas/issue/v1/brownfield.schema.json` | 調査範囲、構成、コマンド、設定名と所在、リスク、未確認事項 |
| `.ai-workflow/templates/issue/v1/*.yaml` | 各schemaに適合する、置換して使う合成記入例 |
| `tests/workflow-schema/` | 正常・異常fixture、変更条件と期待成否のcase一覧 |
| `tools/workflow-schema/` | 同梱成果物の適合テストと専用の開発依存 |

各schemaの`$id`は`urn:ai-workflow:issue:v1:<kind>`である。共通定義への`$ref`もこのURNを使い、検証器へ全5 schemaをローカル登録する。URNやメタスキーマのURLを検証時にネットワーク取得しない。

全成果物で`schema_version: 1`、`artifact_kind`、`work_id`、`work_source`、`updated_at`、`updated_by`を必須とする。`work_source: github_issue`ではIssue URLの`issue_ref`も必須。`external`では省略でき、他の管理ツールの契約は`reference`で参照する。`work_id`はGitHub利用時に`issue-<番号>`を推奨し、URLとの一致確認は後続checkerが行う。`project_id`と`feature_id`は任意で、未設定でも検証できる。

共通IDは小文字英数字をhyphenまたはunderscoreで区切る1～128文字。project IDは上位のproject設計に従いhyphenを使う。GitHub loginは1～39文字の英数字・hyphen。日時はタイムゾーン付きのdate-time文字列で記録する。YAMLでは日時を引用符で囲み、単一文書・重複キーなし・aliasなしで記述する。

`updated_by`、工程の`decided_by`、履歴の`actor`は同じactor objectを使う。`actor_type`は`human / ai_agent / bot / system`。`ai_agent`と`bot`では`on_behalf_of`に人間のGitHub loginを必須とする。`system`は人間の依頼を代理しないシステム処理の記録用であり、代理実行を表す用途には使わない。actorの種類や本人性をschemaだけで認証することはできない。

参照は`{kind, target, fragment?}`とする。`kind: file`はrepository相対のファイルまたはディレクトリ、`url`はHTTPS URL、`id`は成果物内の安定IDを表す。`fragment`は見出し、operation、テスト、schema内の位置などの補足である。fileのv1形式は英数字・underscore・hyphen・dotをslashで区切り、絶対パス、親ディレクトリ、空白、backslashを許可しない。参照先の存在・アクセス可否・fragmentの有効性はこのschemaでは検査しない。

### 4.2 記入上の対応関係

- plan: `revision`は1以上。`stages[]`で`stage_id`、`selection`、`reason`、`evidence`、`decided_by`、`depends_on`、`artifacts`、`approval_required`、`validation_methods`を記録する。適用条件の根拠はreasonとevidence、解決済みルールの参照は`resolved_rules`へ記録する。
- state: `current_stage / last_completed_stage / next_stage`は該当なしの場合null。`stages[]`、`validations[]`、`approvals[]`、`blockers[]`、`failure_reason`、`resume`、`history[]`を持つ。履歴未記録の初期状態は空配列を許可するが、既存履歴の削除は許可しない運用とする。`issue_updated_at`はexternal運用で参照時刻がない場合nullとする。
- history: 標準eventごとに`event_id / event_type / occurred_at / actor / stage / before / after / evidence`を記録する。作業全体のeventはstageをnull、初回作成のbeforeはnullとする。計画改訂では`plan_revision`と`reason`も記録する。
- traceability: `nodes[]`の`kind`にAC、非スコープ、要件、設計、API、Gate、承認、テスト、変更、検証、未決事項、残課題、後続Issue、featureを区別する。`links[]`はIDでfrom/toを結ぶ。`checks[]`は境界とwarn/block/pass、`suppressions[]`は理由・期限・人間の承認参照を持つ。
- Brownfield: `depth`は`low / medium / high`。`commands[]`は実行命令ではなく調査記録で、`documented / verified / not_verified`と根拠・副作用を区別する。`settings[]`はnameとlocationだけを持ち値を保存しない。data_models、flows、ownership、constraints、risks、unknowns、unanalysed、document_updates、follow_upで未解析や後続作業も残す。

配列はstage一覧とBrownfield scope、工程判断・eventの根拠を除き空を許可する。これは書き始めの形式を受理するためで、必要な成果物が空でも工程を完了できるという意味ではない。空欄を埋めるために架空の承認・実行結果を作らない。

### 4.3 形式検証の責務と限界

schemaは型、必須field、enum、形式、条件付き必須、未知fieldを検査する。top-levelは共通定義との合成に`unevaluatedProperties: false`、nested objectは`additionalProperties: false`を使う。独自情報はtop-levelの`extensions`だけへ保存し、core契約を上書きできない。

同梱テストはschemaの妥当性、テンプレートとfixtureの成否、診断の決定性、入力が変更されないことを検証する。任意の利用先成果物を操作するCLIや、ワークフローのGolden Testではない。

以下のうち工程・履歴・再開の構造検査は第5.4・6.4節のcheckerで提供する。宣言されたAC対応の網羅と参照は第7章のcheckerで検査する。外部本人性・自然言語の意味は人間レビューの責務として残す。

- 参照先の存在、IDの意味上の一意性、featureやIssueとの一致。
- 必須工程の網羅、依存循環、同時実行、状態遷移、現在地と履歴の一致。
- 追記履歴が削除されていないこと、改訂時の理由、成果物の新旧。
- ACとテスト・変更・検証の網羅、承認の適用範囲・有効性・本人性。
- 自然言語、URL、extensions内に秘密情報・個人情報・本番データが含まれないこと。

形式に適合しても意味的に安全とは限らない。失敗時に元ファイルを変更したり、完了状態を推測して補完したりしない。非対応versionや破損時の移行・fallbackは`versioning-policy.md`に従う。

## 5. 適応的な実行計画

### 5.1 入力と出力

入力:

- Issue契約、assignee、ラベル、承認履歴。
- `docs/system-context.md`、`docs/architecture.md`、関連要件・設計・API定義。
- 変更リスク、変更予定領域、既存コードの有無。
- 適用される共通、条件付き、opt-inルール。

出力:

- `plan.md`と`plan.yaml`。
- 各ステージの`required`、`optional`、`skipped`。
- 採用・省略理由、依存関係、成果物、承認点、検証方法。

### 5.2 標準ステージ

| ID | ステージ | 標準適用条件 | 主な成果物 | 境界の承認・検査 |
| :--- | :--- | :--- | :--- | :--- |
| `intake` | Issue契約確認 | 常時必須 | 計画、着手条件 | assignee、契約、不明点、競合 |
| `context` | 全体前提確認 | 常時必須 | 参照文書一覧 | System Context、Architectureとの整合 |
| `brownfield` | 既存資産解析 | 既存コードへ初導入、構成不明時 | Brownfield成果物 | 調査範囲、変更なし、残リスク |
| `prototype` | プロトタイプ | 営業デモ、要件確認、技術検証時 | `docs/prototype.md` | 本番との差分、知見の反映先 |
| `requirements` | 要件定義 | 機能・仕様変更時 | 要件またはIssue本文 | AC、スコープ、例外との対応 |
| `design` | 設計 | Low Risk軽微変更を除き原則必須 | 設計または共通文書 | 要件、影響範囲、未決事項との対応 |
| `api` | API定義 | API変更時 | OpenAPI | 設計、互換性、認証認可との対応 |
| `quality` | Quality Gates | 該当ゲートあり、High Risk | Gate判定 | High Riskは人間の明示承認 |
| `tests` | テスト作成 | 実装変更時 | AC対応テスト | ACとテストの追跡性 |
| `implementation` | 実装 | コード・設定変更時 | 最小差分 | 承認済み設計と非スコープ |
| `validation` | 検証 | 常時必須 | 検証結果 | AC、回帰、未検証事項 |
| `handoff` | 引き渡し | 常時必須 | PRまたは完了報告 | Issueリンク、残課題、状態終端 |

### 5.3 選択、スキップ、上書き

- `intake`、`context`、`validation`、`handoff`は省略不可とする。
- Issueの受け入れ条件やリスク分類が要求するステージは省略できない。
- スキップには`reason`、判断根拠、判断者を必須とする。
- 人間は工程を追加・必須化できる。必須工程の省略は、Issue契約を更新したうえで明示承認を記録した場合だけ許可する。
- 計画変更時は既存計画を黙って上書きせず、`revision`を増やし、変更理由と影響を状態履歴へ残す。

計画生成に失敗した場合は、従来工程へ安全側にフォールバックし、不明な工程を自動で省略しない。契約不足、競合、High Risk未承認は`blocked`として実装前に停止する。

### 5.4 実装済みの静的checker

`tools/workflow-check/`はNode.js 22以上のread-only libraryを提供する。
人間やAIが作成した計画を検査するもので、自然言語から計画を生成せず、工程やGit操作を実行しない。
context/result/state-extension schema v1の正本は`.ai-workflow/schemas/checks/v1/`、URNは
`urn:ai-workflow:checks:v1:<kind>`。既存plan/state schema v1の受理集合を変更しない。

入力は`checkWorkflow({ plan, state, context, ruleInput, previous, revisionPlans })`。

| 入力 | 責務 |
| :--- | :--- |
| plan / state | 既存schema v1の現在の作業計画・状態 |
| context | 人間が確認した契約、担当、依頼準備、競合、Git、事実、Gate判定のsnapshot |
| ruleInput | loadRulesで再読込した現在のmetadata・原文digest、rule context、opt-in参照 |
| previous | 任意の直前plan/state。履歴と承認・検証・拡張の追記性を比較する |
| revisionPlans | 改訂履歴に現れる過去のplan。初回revisionは1、以後は1ずつ増やす |

contextはschema_version、work_id/work_source、GitHub利用時のissue_ref、任意project_id/feature_id、risk、
contract_ref、assignee（externalでは責任を持つ人間owner）、ready_for_ai、issue_updated_at、conflicts、gitを持つ。
gitはcommit/branch/clean/remote_matchesを持ち、snapshot収集をlibraryが代行しない。
GitHub利用時のwork_idはissue-番号とし、Issue URLの番号と一致させる。

factsの各値は`{ value: true/false/null, evidence: [...] }`で、needs_brownfield、needs_prototype、changes_spec、
minor_change、changes_api、changes_implementationを必須にする。
gatesはnfr/security/resiliencyそれぞれの`applicable: true/false/null`、reason、evidenceを持つ。
nullは不明であり、工程が不要との判定に転用しない。snapshot自体の事実性・鮮度や自然言語契約との対応は人間が確認する。

省略不可4工程に加え、事実trueに対応する工程、Medium/Highのdesign、Highまたは該当Gateありのquality、
実装変更時のtests/implementation、context.required_stagesをrequiredにする。
条件に該当しなくても、人間がより厳しい工程を追加・必須化できる。
skippedは理由・根拠・判断者を要求する。必須条件による工程の例外的skipには、context.skip_overridesで
stage/plan_revision/更新済みcontract_ref/reasonと人間のstage-skip承認参照を要求する。
省略不可4工程、または現契約のrequired_stagesと矛盾するskipは許可しない。
履歴の例外skipは当該人間のactor・承認参照・時刻も照合する。

明示depends_onに、intake→context、各選択工程のintake/context境界、requirements→design、
design/api/quality→tests、tests→implementation、作業工程→validation→handoffの暗黙依存を加える。
存在・適用する工程だけを暗黙依存の対象にする。未知依存、skipped工程への依存、合成グラフの循環を拒否する。
テスト前に実装できる経路は、明示承認された工程例外以外には作らない。
次候補は依存が完了したpending工程を第5.2節の標準順で1つだけ返す。
planでskippedの工程は実行候補にしないが、完了状態にはstage_skippedの記録が必要。
optionalは人間が採用した工程として扱い、自動skipしない。

plan.extensions.rule_resolutionとresolved_rulesは現在のruleInputで再解決して照合する。
拡張のない旧planは形式上有効でも、新checkerでは明示移行が必要としてblockする。
診断はcode/path/stage/eventのみで、入力本文・コマンド・秘密値を出力しない。
resultは各checkのpass/block/not_evaluated、全体pass/blocked、input_digest、checker_version、
resume_decisionとnext_stageを持つ。実行時刻を挿入せず同じ入力で同じ結果になる。
検査ごとの結果を確認する。state検査がpassでもresume検査がblockなら全体はblockedとなる。

## 6. 状態管理と再開

### 6.1 状態モデル

作業全体の状態は次のいずれかとする。

```text
planned -> in_progress -> awaiting_approval -> in_progress -> completed
                     \-> paused ------------/
                     \-> blocked -----------/
                     \-> failed ------------/
                     \-> cancelled
```

- `planned`: 計画作成済み、作業未開始。
- `in_progress`: 1つのステージを実行中。
- `awaiting_approval`: 人間の判断待ち。後続ステージへ進まない。
- `paused`: 安全な境界で意図的に中断し、再開情報を保存済み。
- `blocked`: 契約不足、競合、外部依存などで安全に進めない。
- `failed`: 検査または処理が失敗し、再実行が必要。
- `cancelled`: 人間が作業を終了した終端状態。自動再開しない。
- `completed`: 必須ステージと境界検査が完了。

各ステージは`pending`、`in_progress`、`completed`、`skipped`、`blocked`、`failed`を持つ。同時に`in_progress`にできるステージは1つとする。

### 6.2 `state.yaml`の必須情報

- `schema_version`、`work_id`、`plan_revision`。
- `issue_ref`。プロジェクト統制へ接続する場合は`project_id`と`feature_id`。
- 作業全体と各ステージの状態。
- `current_stage`、最後に完了したステージ、次に許可されたステージ。
- 参照したGit commit、ブランチ、Issue更新時刻。
- 実行した検証と結果。
- 承認種別、承認者、承認先URLまたは記録場所、承認時刻。
- ブロッカー、失敗理由、安全な再実行方法。
- 更新者種別と更新時刻を含む追記型の履歴。

履歴の各項目は`event_id`、`event_type`、`occurred_at`、`actor_type`、`actor_ref`、対象ステージ、変更前後の状態、根拠参照を持つ。`actor_ref`は人間の場合はGitHub login、AIエージェントやbotの場合は機械主体の識別子とする。AIエージェントや共有botが人間の依頼で更新する場合は、責任を持つ人間のGitHub loginを`on_behalf_of`へ必ず記録し、AIエージェント名をassigneeや開発メンバーとして扱わない。認証情報、token、メールアドレスは記録しない。初期スキーマで扱う`event_type`は次を標準とする。

- `work_planned`、`plan_revised`
- `stage_started`、`stage_completed`、`stage_skipped`
- `approval_requested`、`approval_recorded`
- `work_paused`、`work_resumed`、`work_blocked`
- `work_failed`、`work_cancelled`、`work_completed`

状態イベントはIssue内部の監査・再開情報を表し、プロジェクト側は集約用入力として参照できる。ただし、イベントだけからassignee変更、claim取得、次Issueの自動割当を行ってはならない。プロジェクト側が取り込んだイベントのcheckpointを管理し、同じ`event_id`の再処理は状態を重複更新しない冪等な扱いとする。イベントの配送保証、同期方向、競合復旧はproject orchestrationの責務とする。

### 6.3 再開手順

1. Issue、ブランチ、作業ツリー、remoteとの差分、既存PRを再確認する。
2. YAMLのスキーマ、`work_id`、計画revision、Git参照の整合を検査する。
3. Issueまたは上位ルールの更新を検出し、計画への影響を差分化する。
4. 最後に完了した境界検査を再確認する。
5. `failed`または実行途中の副作用を確認し、冪等性が不明なら自動再実行しない。
6. 人間へ現在地、差分、ブロッカー、次の1ステージを報告して再開する。

正常な中断では、実行中ステージを安全な境界まで戻して`paused`にし、未完了操作と次の作業を記録する。やり直しでは対象ステージとその下流を`pending`へ戻し、計画revision、理由、無効化した成果物を履歴へ記録する。状態ファイルが欠損・破損・古い場合は、Git履歴、Issue、成果物から復元案を作るが、自動で完了状態を推測しない。復元不能な承認は再承認を求める。

### 6.4 履歴再生・改訂・再開の実装契約

初回work_plannedのbeforeはnull、afterはplanned、stageはnull。空履歴はrevision 1の初期plannedだけに許可する。
event_id一意、時刻非減少、snapshot更新時刻以前を要求する。同時刻は配列順を実行順として扱う。
各履歴を再生し、作業状態・stage状態・current/last_completed/nextがsnapshotと一致することを検査する。
previousも単独で履歴との整合を検査してから、prefixと保持済み証跡を比較する。

| event_type | 許可する遷移・動作 |
| :--- | :--- |
| work_planned | 初回のみnull→planned、全stage pending |
| stage_started | pending→in_progress。作業状態planned/in_progress、依存完了、承認有効、他の実行stageなし |
| stage_completed | 実行中の1 stageをcompletedにし、last_completedを更新 |
| stage_skipped | pending→skipped。planで省略済み、必要なら例外承認と人間actorを確認 |
| approval_requested | 実行stageのないin_progress→awaiting_approval |
| approval_recorded | awaiting_approval→in_progress。人間actorと承認参照を確認。stageは開始しない |
| work_paused | 実行stageのないin_progress→paused |
| work_resumed | paused/blocked/failed/awaiting_approval→in_progress。stageは開始しない |
| work_blocked / work_failed | 非終端状態からblocked/failed。実行stageがあれば同状態へ移す |
| work_cancelled | 非終端状態からcancelled。実行stageはblockedとして停止し、終端なので後続eventを拒否 |
| work_completed | 実行stageなし、採用工程完了・省略記録済み、当該revisionのvalidation成功、blockerなし |
| plan_revised | 非終端状態からplanned。revisionを1増加し、起点と下流stageをpendingへ戻す |

work eventのstageはnull、stage eventは対象stageを持つ。completed/cancelled後に再開しない。
work_blockedの直前がblocked、work_failedの直前がfailedの重複遷移は拒否する。
blocked snapshotはblockers、failed snapshotはfailure_reasonが必要。
停止・失敗の履歴だけから副作用の有無は判定できないため、再開には別途resumeの記録と人間の確認を要求する。

state.extensions.workflow_checkはschema_version: 1と次の配列を持つ。

- approval_scopes: reference、plan_revision、stage、contract_ref、approval_recordedのevent_id、rule承認時のrule_id。
- validation_scopes: validation_id、plan_revision、stage。
- revisions: plan_revisedのevent_id、from_revision/to_revision、restart_stage、invalidated_stages、invalidated_artifacts。

state.approvals/validationsの既存形式は変更しない。承認scopeは当該改訂・契約・stageへ結び付け、
承認者loginと人間actor、参照、時刻を照合する。Highはtests/implementation開始前にdesign/quality承認が必要。
approval_requiredまたはcontext.approval_stagesの工程にはapproval_type: stage、
選択済みruleのapproval_requiredにはtests/implementationの対象stageでapproval_type: ruleとrule_idを要求する。
後からの承認で以前の不正な開始を正当化しない。scopeの照合は外部承認の本人性を保証しない。

previousのhistory、approvals、validations、workflow_check配列は同じprefixを保持する。
既存証跡を書き換えず追加する。同一revisionで計画内容を変えたり、履歴を切り詰めたりしない。
更新日時・更新者だけの変更は計画内容の改訂と区別する。
計画改訂にはeventのreason/evidence/plan_revisionとrevisionsの詳細が必要で、起点から旧新依存グラフの下流を無効化する。
無効化対象の旧成果物参照を記録し、変更したstageを無効化対象外に残さない。
旧承認・検証は保存するが、新revisionの工程通過には再利用しない。
過去planが足りなければ停止する。過去planも現在提出された事実・契約を安全側に適用して検査するため、
当時の例外が現契約で証明できない場合は人間の移行レビューが必要となる。

再開候補には、担当・ready-for-ai・競合なし、Git commit/branchの一致、clean/remote一致、
Issue更新時刻の一致、最新rule結果、有効な計画・証跡を要求する。
初期planned以外（再計画後のplannedを含む）はpreviousと最後の完了stageに対する当該revisionの検証成功が必要。
未完了pending_operations、safe_to_retry=false、context.retry_review.confirmedが不明/falseなら候補を返さない。
blocked/failed/awaiting_approvalのまま、またはstage実行中のsnapshotは、state検査が通ってもresumeはblockする。
人間が理由を解消し、根拠・再計画・再開eventを明示記録して再検査する。checker自身は修復や再実行をしない。
previousがなければ追記性はnot_evaluatedであり、初期planned以外の再開を許可しない。

## 7. フェーズ境界の追跡性検査

### 7.1 追跡対象

`traceability.yaml`では、少なくとも以下のIDとリンクを管理する。

- Issueの受け入れ条件と非スコープ。
- 要件、設計判断、API operationまたはschema。
- Quality Gate判定と承認。
- テストケース、変更ファイル、検証結果。
- 未決事項、残課題、後続Issue候補。
- `feature_id`がある場合は、Issue契約および対象featureとの対応。

### 7.2 検査タイミングと強度

| タイミング | 検査 | 判定 |
| :--- | :--- | :--- |
| 作成途中 | 必須ID、リンク先、重複、未解決参照 | warn |
| 要件から設計 | ACごとの要件・設計対応、非スコープ混入 | 不足はblock |
| 設計から実装 | 設計、API、Quality Gate、承認の完了 | 必須項目不足はblock |
| 実装からPR | ACごとのテスト・変更・検証結果、未検証事項 | 必須項目不足はblock |
| 完了時 | 全必須ステージとリンク、残課題の移送 | 不整合はblock |

静的検査はスキーマ、ID、ファイル、参照の存在と状態から、欠落、孤立成果物、未承認状態を判定する。構造化された値の矛盾は静的にblockし、自然言語の意味上の矛盾は人間へ報告する。AIによる意味整合性評価は初期リリースでは任意かつinformationalとし、単独で承認やblock解除を行わない。偽陽性は抑制理由と期限を記録し、人間が承認する。

### 7.3 実装済みの追跡性checkerと正本台帳

`tools/workflow-trace/`はNode.js 22以上のread-only libraryであり、
`checkTraceability({ traceability, workflowInput, context, references })`を提供する。
既存traceability/plan/state/rule/checks schema v1を変更せず、追加schemaのcontext/result/suppression-scopeを
`.ai-workflow/schemas/trace-checks/v1/`へ配置する。URNは`urn:ai-workflow:trace-checks:v1:<kind>`。

contextの必須情報はwork_id/work_source、GitHub利用時のissue_ref、plan_revision、contract_ref、boundary、evaluated_at、
criteria、non_scope、change_inventory、external_confirmations、suppression_scopesである。
project_id/feature_idは任意。criteriaは空にできない。各ACにid/ref/required_kinds/exemptionsを記録する。
required_kindsはrequirement/design/api/test/change/validationの追加要求であり、標準要求を減らさない。
exemptionsはkind/reason/evidence/confirmationを持ち、planで省略済みの工程に限り非該当説明を裏付ける。
confirmationのapproval_typeはnot-applicable。採用済み工程の要求を解除するためには使えない。

non_scopeはid/refの配列。change_inventoryはnode_id/path/operation（added/modified/deleted）を持ち、deletedは
base_digest（SHA-256）を必須にする。Git差分自体は呼出側が確認し、loaderはGit commandを実行しない。
AC・非スコープ・変更の台帳とnodesを照合し、重複・記録漏れ・無関係な余分のAC・改訂不一致を検出する。
台帳とIssue本文の意味上の一致、change_inventoryが真のGit差分かどうかは人間が確認する。

workflowInputは第5.4節のcheckWorkflowへ渡す現在の入力であり、同checkerを必ず再実行する。
schema/identity/rules/plan/stateのpassを前提とし、draft以外はpreviousを用いた追記性確認も必要とする。
単なる実行中・承認待ちのresume停止と追跡グラフの破損を混同しないが、担当・Git・Issue・安全な再試行の
確認失敗は境界検査もblockする。evaluated_atが提出されたplan/state/traceabilityより古い場合は拒否する。
保存済みtraceability.checksのpassを信用せず、現在の入力から再検査する。

### 7.4 型付きリンクと境界判定

| relation | 向きと役割 |
| :--- | :--- |
| satisfies | requirement → acceptance_criterion |
| implements | design → requirement、api → design、change → design/requirement/AC |
| verifies | test → AC/requirement/design/api、validation → test/change/quality_gate |
| references | 補助参照。AC網羅・実装・検証の経路を証明しない |
| excludes | non_scope → requirement/design/api/test/change。除外対象の採用・完了を検出 |
| follows_up | open_question/remaining_work → follow_up |

未知端点、自己参照、重複、型・向きの不一致を検査する。
要件・設計・API・テスト・変更・検証は、補助参照だけでなく型付き経路で正本ACへ到達する必要がある。
not_applicableのnodeは網羅経路に使わない。理由に加え、除外対象または非該当説明との一致が必要。
changeのimplementsは採用済みの設計・要件を飛び越せない。
referencesの循環は一律禁止せず、訪問済み集合で検査を終了する。

requirements_to_designは採用された要件のcompleteと設計対応先を要求し、次に作成する設計のpendingを許容する。
設計開始前の予定ファイルの不存在を、必要な完了証跡の欠落とは混同しない。
design_to_implementation以降は採用された設計/API、該当Gate、必要な承認を検査する。
Highはdesign/quality承認、工程のapproval_required、選択ruleの実行前承認を当該scopeへ照合する。
approval nodeの参照とreferences先はstate.approvals/approval_scopesの契約・revision・対象stageと一致させる。

implementation_to_pr以降はACごとに採用されたテスト、変更一覧に対応する変更、検証を要求する。
各test/changeはvalidationからverifiesで確認されていなければならない。
validation nodeはstateの当該revision・validation工程にscopeされた記録へ結び付ける。
同じ参照に複数の検証がある場合は日時、同時刻なら配列順で最新を選び、古い成功で新しい失敗を隠さない。
completionは全採用工程の完了・省略記録、ACのcomplete、残課題のfollow_upへの引き継ぎを要求する。
後続Issueリンクだけで必須ACや失敗検証を完了扱いしない。

第7.2節に従い、draftのグラフ・対応・孤立・必要参照の不足はwarn、工程境界の必要不足はblock。
schema/正本台帳/識別子/改訂/安全性/未承認・失敗検証/非スコープはdraftでもblockする。
feature_idがある場合は同IDのfeature nodeとACへのreferencesを要求する。Project runtimeは更新しない。
検査するのは宣言された対応であり、記載されていない意図やコードの意味を推測しない。

### 7.5 参照確認と期限付き抑制

referencesはloaderが返す確認snapshotである。純粋関数はI/Oせず、次を区別する。

| status | 意味 |
| :--- | :--- |
| local_verified | root内の通常ファイルとdigest、対応fragment、または内部IDを確認 |
| human_asserted | URLについて人間の確認記録がある。外部到達性を自動検証した意味ではない |
| deleted_declared | 台帳に削除・base_digestがあり、現在のファイルがない。過去Git内容は人間確認 |
| missing | 必要なファイル・対象が存在しない |
| not_evaluated | 未対応fragmentや未確認URLなど、検証していない |

external_confirmationsはreference/confirmed_by/confirmed_at/evidenceを持ち、未来の確認を受理しない。
URLは取得せず、コマンドやテスト本体を実行しない。
fileは既存readLocal境界（1 MiB、root内通常ファイル、symlink/親参照拒否）を維持する。
JSON/YAMLのfragmentはJSON Pointer（例: /paths/~1profile/get）、Markdownは明示anchor（例: {#ac-1}）のみ対応。
GitHubの自動見出しanchor、任意のテスト関数名等は未評価とする。
安全な通常ファイルが存在するだけでは、テストが実行されたことや内容の正しさを保証しない。

既存suppressionsはcheck_id/reason/expires_at/approvalを維持する。
context.suppression_scopesはschema_version/check_id/subject_digest/plan_revision/boundary/node/edge/pathを持つ。
check_idは診断code・対象・境界から作り、同じcodeでも別ACや別リンクを一括抑制しない。
subject_digestは規則versionと実質入力から計算し、checks/suppressions/suppression_scopes/evaluated_atを除外して
自己参照を避ける。input_digestは評価時刻と抑制も含めた全入力の識別用。
日時だけの変更では承認対象を変えず、契約・plan/state・グラフ・参照snapshotの変更で古いscopeを拒否する。

期限はevaluated_atと比較する。期限ちょうど、期限切れ、未来の承認、重複・未知check_id、古いscopeはblock。
approval_type: suppression、人間login、同じ承認参照の人間確認記録を要求するが、本人性の証明ではない。
schema/安全性/識別子/改訂/正本台帳/未承認・失敗検証/非スコープ/workflowのblockは抑制できない。
適用済み抑制も元severityと診断を残してsuppressed表示し、全体warnとする。抑制だけでpassにしない。

### 7.6 結果の扱いと保持

結果はschema/checker version、input/subject digest、boundary、ACごとの対応、安定した診断、参照結果、
traceability.checksへ転記できる候補を返す。入力を変更せず、自動保存・state更新・工程開始・承認をしない。
判定はpass/warn/blocked。warnは未完成や承認済み例外を含むので、人間が内容を確認してから扱う。
未確認や不正入力を都合よく補完せず、元成果物を保存して従来のIssue運用へ戻れる。
外部本人性、自然言語の対応の正しさ、テスト本体の実行成功、実際のGit差分は人間または後続adapterで確認する。

## 8. モジュール式ルール

### 8.1 ルール単位

各ルールは、機械可読なメタデータと人間向け本文を持つ。

- 一意な`rule_id`と`version`。
- `level`: `always-on`、`conditional`、`opt-in`。
- `applies_when`: リスク、領域、技術、データ種別などの適用条件。
- `requires`、`conflicts_with`、適用順序。
- 違反時の`severity`: `warn`または`block`。
- 目的、入力、期待出力、失敗時の行動、承認要否。

### 8.2 適用レベル

- `always-on`: Issue契約、非スコープ、承認、秘密情報保護など、全作業で必須。
- `conditional`: API、認証、Infrastructure、個人情報、Brownfieldなど、条件一致時に必須。
- `opt-in`: プロジェクトが明示採用する追加規約。上位ルールを緩和できない。

共通モジュールは将来の`docs/common/rules/<rule-id>/`、プロジェクト固有・opt-inモジュールは`.ai-workflow/rules/<rule-id>/`を正本とし、それぞれ`rule.md`と`rule.yaml`を対にする。Security、Testing、Resiliency、Architectureなどの分類はmetadataで表現する。ツール別入口ファイルは解決済みルールへの参照、または同じ正本から生成した内容だけを持ち、独自ルールの正本にしない。

初期実装では、現行の`AGENTS.md`と`docs/common/development-rules.md`を単一のlegacy always-onモジュールとして維持し、分割移行を一括で行わない。ルール解決結果は計画へ記録し、未知の条件や循環依存を検出した場合は安全側でblockする。

### 8.3 実装済みのrule schema v1とlibrary

`.ai-workflow/schemas/rules/v1/`の`rule`、`context`、`resolution`を正本とする。
Draft 2020-12とローカルURN（`urn:ai-workflow:rules:v1:<kind>`）を使用し、未知core field・versionを拒否する。
`tools/workflow-rules/`はNode.js 22以上の独立したオフラインlibraryで、統合CLIや工程実行器ではない。

| metadata | 契約 |
| :--- | :--- |
| `schema_version` / `rule_id` / `version` | schema v1、一意ID、固定SemVer。範囲指定やlatestは使わない |
| `level` / `category` | always-on / conditional / opt-in、分類IDの配列 |
| `applies_when` | 条件のAND。各条件は`fact`と非空`any_of`配列 |
| `requires` | 適用を要求するrule_idと固定version |
| `conflicts_with` / `after` | 競合するID、先に適用するID。afterは必須採用を意味しない |
| `severity` | ルール違反のwarn/block。resolver構造エラーのblockを緩和しない |
| `purpose` / `inputs` / `expected_outputs` / `on_failure` | 目的、入力、期待出力、失敗時の人間向け手順 |
| `approval_required` / `body_refs` | 実行前承認要否、repository内の本文参照（fileのみ） |

contextの`schema_version: 1`は必須。`risk`はlow/medium/high、`areas`、`technologies`、`data_types`は文字列配列。
条件のfactはこの4つに限定する。配列はany_ofとの共通要素、riskは列挙値の一致で判定する。
空配列は既知の該当なし、項目欠落はunknown。ANDはfalseを優先し、falseがなくunknownがある場合はblockする。
always-onの条件は空、conditionalは1件以上。opt-inは人間の採用承認参照を伴う明示採用と条件一致の両方が必要。
未知条件キー・演算子は未採用opt-inでも形式エラー。技術名や領域名は利用先が定義する文字列である。

処理順は形式検査、条件選択、宣言グラフ検査、競合検査、必須依存確認、決定的なtopological sort。
共通とproject固有の同一ID上書きは不可。未知参照、固定version不一致、自己参照、requiresとafterの合成循環は
未選択ルールを含む宣言全体でblockする。未選択のrequiresを自動有効化せず、opt-inの承認も補完しない。
片側のconflicts_withでも両候補をconflictedにして全体blockする。依存先がconflictedの選択候補もconflictedになる。
順序が自由な候補はalways-on、conditional、opt-in、rule_idのコードポイント辞書順で決める。
依存順やafterは実行順序であり、第3.1節の契約上の優先順位を覆さない。

`docs/common/rules/legacy/`はAGENTS.mdとdevelopment-rules.mdを単一always-onとして参照する。
元本文は維持し、移動・複製・一括分割しない。legacyの欠落、opt-out、override、原文片方欠落はblock。
旧planにあるversion文字列`1`はそのまま既存plan schemaで受理される。新ruleの初期versionは`1.0.0`。

### 8.4 解決結果と計画への記録

`resolveRules`は`selected/not_applicable/conflicted`、理由コード、本文metadata参照、適用順、診断、全体`pass/blocked`を返す。
不明条件や依存不成立もconflictedで表し、診断コードで原因を区別する。構造不正な入力は診断に残し、選択済みとはみなさない。
blocked時のorderは空。個別にselectedのルールがあっても全体の工程通過を許可しない。
`severity: warn`や`approval_required: false`はresolverのblock解除や人間承認を意味しない。
自然言語本文の矛盾、人間指示との意味上の衝突は人間レビューで確認する。

結果にはresolver version、context、opt-in採用参照、入力全体のSHA-256 digest、入力文書ごとのdigestを保持する。
`loadRules(root)`でmetadata、対のrule.md、body_refs（legacy原文を含む）のdigestを集める。
配列入力のrule/opt-in順は正規化し、現在時刻・絶対パスを暗黙挿入しない。同じ入力で同じ結果を返す。
rule内の条件・配列の編集も入力変更として再解決対象にする。

`projectPlan(plan, result, currentInput)`は入力を再解決し、古い/改変された結果やrisk不一致を拒否する。
成功時だけ既存plan v1のresolved_rulesへID/version/metadata参照を投影し、詳細を
`extensions.rule_resolution`へ保存した新しいobjectを返す。plan本体と拡張用resolution schemaの両方を検証する。
既存plan schema単体では自由拡張の意味や本人性を保証しない。
計画revision・updated_at・actorの更新と保存は呼出側で明示し、元planを自動上書きしない。
stateの遷移、承認の真正性照合、GitHub更新は実行しない。

loaderは指定root内の通常ファイルのみを読み、symlink（root配下の経路を含む）、絶対パス、親参照を拒否する。
1ファイルは最大1 MiB、YAML 1.2単一文書・重複キーなし・aliasなし・custom tagなし。
URL取得、shell command、evalは実行しない。読み込み失敗は例外として停止し、部分成功結果を返さない。
純粋関数resolveRulesは渡されたmetadataの解決用であり、ファイル実在・原文digestの収集はloadRulesの責務である。
保存前にはloadRulesで現在の原文を再読込する。digestは改変検知用で、署名や承認者認証ではない。

## 9. Brownfield解析

### 9.1 適用条件と安全境界

既存コードへ初めてテンプレートを導入する場合、主要構成が不明な場合、またはIssueの変更が未知領域へ及ぶ場合に適用する。解析は読み取り専用とし、機能実装、リファクタリング、依存更新、生成物更新、API・Infrastructure変更を含めない。

### 9.2 最小出力

- ディレクトリと主要コンポーネントの責務。
- 技術スタック、実行、ビルド、テスト、デプロイの確認済みコマンド。
- Frontend、Backend、API、Auth、Data Store、Infrastructure、外部サービスの現状。
- 主要データモデル、依存関係、主要なデータ・リクエストフロー。
- 設定値の名前と所在。値や秘密情報は記録しない。
- 既存文書、テスト、CI/CD、所有境界、品質課題と不足。
- 変更禁止領域、暗黙の制約、互換性・運用上の前提。
- Issueに関係する変更候補領域、既知リスク、未確認事項、後続Issue候補。
- `docs/system-context.md`と`docs/architecture.md`の作成・更新案。

### 9.3 深度

- Low: Issue関連領域と隣接依存だけを調査する。
- Medium: 主要コンポーネント、結合点、テスト・デプロイ経路まで調査する。
- High: 認証認可、データ境界、外部連携、Infrastructure、復旧経路を追加し、人間が調査範囲を承認する。

解析対象が大きすぎる場合は時間・ディレクトリ・領域で上限を設定し、未解析領域を明記する。ツール実行が副作用を持つ可能性、秘密情報へアクセスする可能性、費用が発生する可能性がある場合は実行せず、人間へ確認する。

### 9.4 実装済みの調査手順と深度別テンプレート

詳細手順は[Brownfield解析ガイド](brownfield-analysis-guide.md)に定義する。
`.ai-workflow/templates/brownfield/v1/{low,medium,high}/`に対になるbrownfield.md/yamlを提供する。
Low/Mediumは未確認を残すpartial、Highは人間の調査範囲承認待ちのblockedという合成例である。
実作業への保存先は`.ai-workflow/issues/<work-id>/brownfield.{md,yaml}`とする。
旧最小テンプレートと既存brownfield schema v1は変更しない。

YAMLを構造化された正本、Markdownを方針・判断・引き継ぎの説明にする。矛盾時は人間へ差分を示して停止する。
extensions.brownfield_reviewには基準commit・上限・承認待ち等の任意メモを残せるが、schemaはその意味や本人性を保証しない。
commandsは記録だけに使い、依存導入・生成・run/build/test/deploy・外部API・クラウド接続を実行しない。
verifiedは人間が承認した別の検証記録と実施条件を確認できる場合に限定する。資料中の命令文でscopeを広げない。
設定名と所在のみを保存し、秘密値・個人情報・本番データ・ログ原文を収集しない。

completeは合意scope内の必須確認の完了であり、本番安全性や実装開始の許可ではない。
partial/blockedは未確認・未解析・停止理由と後続候補を残す。Highは範囲承認まで解析を開始しない。
system-context/architectureは更新案にとどめ、対象コードや利用先文書を自動変更しない。
調査の上限到達・権限/安全性/承認不足では元成果物を保持し、既存plan/stateの人間確認・改訂・再開手順へ戻す。

`npm run test:brownfield --prefix tools/workflow-schema`は同梱例専用のオフライン適合テストである。
自動解析器、実行器、任意成果物の意味checker、Golden Test共通ハーネスは提供しない。

## 10. ワークフローのGolden Test

### 10.1 目的と構成

Golden Testはアプリケーション機能ではなく、計画生成、ルール解決、状態遷移、境界検査の回帰を検出する。将来の実装では次の構成を標準とする。

```text
tests/workflow-golden/
  fixtures/<case-id>/
    input/               # Issue、文書、ルール、初期状態の最小fixture
    expected/            # 計画、状態遷移、検査結果
    forbidden.yaml       # 起きてはならない工程・変更・判定
```

各fixtureは、目的、対象機構、入力、期待出力、禁止出力、期待するwarn/block、固定化しないフィールドを宣言する。

### 10.2 必須ケース

- Low Risk文書変更で不要工程を理由付きでスキップする。
- Medium RiskのGreenfield Featureで要件、設計、テスト、実装を選択する。
- Medium Risk Bugfixで既存仕様と回帰テストを要求し、不要な新規API設計をスキップする。
- High Risk変更でQuality Gatesと人間承認前に停止する。
- High Risk Infra変更でInfrastructure、Security、Resiliencyの条件付きルールを選択する。
- Brownfield初期導入で解析を必須化し、変更工程へ進まない。
- 中断状態から次の1ステージだけを安全に再開する。
- ACとテストのリンク欠落を境界でblockする。
- テスト作成前の実装着手を禁止動作として検出する。
- always-onとopt-inの競合で上位ルールを維持する。
- 秘密情報、Issue外変更、自動承認を出力しない。

### 10.3 実行方式

- オフライン静的テストを必須とし、固定fixtureから決定的な結果を得る。
- YAMLのキー順、時刻、絶対パスなど意味のない差分は正規化する。
- AIによる意味評価は任意の別ジョブとし、失敗しても必須静的テストの結果を上書きしない。
- AI評価にはモデル、prompt version、試行回数、tokenまたは費用上限、タイムアウトを設定する。
- AI評価結果にはモデル、prompt version、試行回数、token、所要時間、推定費用、評価不能理由を記録する。
- 外部送信するfixtureは合成データに限定し、機密リポジトリの内容を送信しない。

## 11. GitHub Actions拡張方針

初期実装では、既存Actionsを壊さず独立したチェックとして追加する。

- PRでワークフローYAMLのスキーマと参照整合を検査する。
- ワークフロー規約・テンプレート・チェッカー変更時にGolden Testを実行する。
- AI評価ジョブは手動または明示opt-inとし、権限を最小化し、fork PRでは秘密情報を渡さない。
- Actionsは仕様の妥当性、人間の承認者本人性、意味上の完全性を自動決定しない。
- 必須チェック化は誤検知率と実行時間を計測した後、リポジトリ設定で段階的に行う。

## 12. Security、Privacy、Cost

- 成果物とfixtureへシークレット、個人情報、本番データを保存しない。
- Brownfield解析は値ではなく設定名と所在だけを記録する。
- Actionsとチェッカーはread-onlyを既定とし、コメント、ラベル、成果物更新などのwrite権限を分離する。
- 外部AI評価は明示opt-in、送信対象の最小化、ログのマスキング、保持方針の確認を必須とする。
- AI評価には1実行当たりのtoken・費用・試行回数・時間の上限を設け、上限到達は失敗ではなく未評価として報告する。
- 生成結果だけで承認、マージ、デプロイ、権限変更を行わない。
- YAML内の承認情報は監査証跡そのものではなく、GitHub上の承認コメントやレビューへの参照とする。承認者本人性は編集可能な状態ファイルだけから判断しない。
- 全promptやAI応答は保存せず、計画revision、状態遷移、検査結果、承認参照だけを最小監査情報とする。保持期間と公開範囲は利用先のデータ分類・リポジトリ方針に従う。
- 静的チェックは通常のPR検証時間内で終わる最小fixtureを既定とし、性能目標と成果物量の上限は実装Issueで計測可能な値として定める。
- 状態更新は追記履歴とschema versionを持ち、破損時は最後の正常境界へ戻れるようにする。復旧不能時も従来のIssueベース工程へfallbackできることをResiliency要件とする。

## 13. 後続実装Issueの分割案

| 順序 | 実装Issue | 主な成果物 | 依存関係 |
| :--- | :--- | :--- | :--- |
| 1 | 共通スキーマと成果物テンプレート | plan/state/traceability/Brownfieldのschemaと例 | 本設計の承認 |
| 2 | モジュール式ルール解決 | ルールmetadata、優先順位・競合検査 | 1 |
| 3 | 適応的計画と状態遷移の静的チェッカー | 選択、スキップ、revision、再開検査 | 1、2 |
| 4 | フェーズ境界の追跡性チェッカー | warn/block判定、抑制記録 | 1、3 |
| 5 | Brownfield解析テンプレート | 読み取り専用手順、深度別出力 | 1、2 |
| 6 | Golden Testハーネスと必須fixture | オフライン回帰テスト | 2、3、4、5 |
| 7 | GitHub Actions統合 | PR静的検査、Golden Test | 3、4、6 |
| 8 | 任意AI意味評価 | opt-inジョブ、予算・privacy制御 | 6、7 |
| 9 | 統合CLIの必要性評価 | 利用実績、UX、保守コストに基づくADR | 7の運用実績 |

各Issueは、対象機構のschema version、後方互換性、移行手順、失敗時のfallback、受け入れ条件を個別に定義する。1から7までは決定的・オフラインに検証可能であることを優先し、AIサービスを必須依存にしない。

共通スキーマの実装Issueでは、project orchestrationとの連携点として`project_id`、`feature_id`、`actor_ref`、`on_behalf_of`、標準状態イベントを定義する。プロジェクトCoordinator、チーム台帳、依存グラフ、claim、自動割当、イベント同期の実装はIssue #9の後続Issueへ分離する。

## 14. 設計承認チェックリスト

- [x] 6機構の目的、入力、出力、状態、適用条件、承認点、失敗時動作が合意されている。
- [x] Issue契約、assignee、`ready-for-ai`、リスク分類、Quality Gatesとの境界が合意されている。
- [x] Issue #9のプロジェクト統制との正本・同期境界と、`project_id`、`feature_id`、`actor_ref`、`on_behalf_of`、標準状態イベントの連携方法が合意されている。
- [x] Markdown＋YAMLの配置、正本、保持方針が合意されている。
- [x] warn/blockと静的検査・AI評価の責務分担が合意されている。
- [x] Security、Privacy、Costの制約が合意されている。
- [x] 後続実装Issueの順序と依存関係が合意されている。

本設計は2026-08-06に明示承認済みであり、後続実装Issueを作成できる。各後続Issueの作成、着手、実装承認は本承認に含めず、個別のIssue契約に従う。
