# Adaptive AI Development Workflow Design

このドキュメントは、AI駆動開発ワークフローを適応的かつ再開可能にするための共通設計を定義する。Issue契約を中心とする既存運用を置き換えるものではなく、実行計画、状態、追跡性、ルール、Brownfield解析、Golden Testの共通境界を追加する。

## 1. 文書の状態

- 状態: 設計承認済み（Issue #8、2026-08-06）
- 承認記録: https://github.com/gorillaimo/ai-driven-dev-template/issues/8#issuecomment-5206128174
- 適用開始: 後続実装Issueが完了し、この文書の各機構が有効化された時点
- 現時点の扱い: データ契約と実装境界の定義。チェッカー、CLI、GitHub Actionsは未実装
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

この設計は1つのIssueまたはwork item内部の工程を対象とする。複数feature / Issue / 開発者 / AIエージェントをまたぐ優先順位、依存グラフ、担当割当、claim、並列wave、共有ファイルの統合責任はIssue #9で扱い、この設計へ混在させない。

将来のプロジェクト集約から参照できるよう、Issue単位の成果物は任意の`project_id`と`feature_id`、標準状態イベントを持てるようにする。これらの参照が未設定でも単一Issue運用はblockしない。`feature_id`の採番、開発順序、担当者の選択、自動割当はプロジェクト側の責務であり、本設計のplan/stateチェッカーが独自に決定しない。

状態の正本は責務ごとに分離する。

| 状態 | 正本 | Issue #8側の扱い |
| :--- | :--- | :--- |
| Issue契約、assignee、claim、PR | GitHub Issue / PR | 読み取り・参照し、独自に割当やclaimを変更しない |
| プロジェクト進捗 | GitHub Issues。採用時はGitHub Projectsを含む | Issue内部状態から投影できるが、プロジェクト側の値を独自に確定しない |
| Issue内部のステージ、再開地点、検証、承認参照 | `.ai-workflow/issues/<work-id>/state.yaml` | 再開と境界検査の正本として更新する |
| feature定義と`feature_id` | `docs/system-context.md` | 対象featureへの参照だけを保持する |
| プロジェクトの依存、wave、チーム、担当可能領域 | Issue #9で定義するプロジェクト成果物とGitHub | Issue内部成果物へ複製しない |

GitHub上の工程表示はIssue内部状態を集約した投影として扱う。GitHubと`state.yaml`に不整合がある場合、どちらかを自動上書きせず`blocked`として差分と更新時刻を提示し、Issue #9で定義する同期・復旧手順へ委ねる。

## 4. 共通成果物

ワークフロー成果物は、IssueまたはGitHubを使わない場合の作業IDごとに配置する。

```text
.ai-workflow/
  project/               # Issue #9が所有するプロジェクト統制用の予約領域
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

`.ai-workflow/project/`は、将来の機能台帳、依存グラフ、チーム台帳、集約状態のために予約する。Issue #8では配下のschemaや更新主体を定義せず、Issue単位のチェッカーもこの領域を書き換えない。

MarkdownとYAMLは同じ事実を別々に管理しない。YAMLを構造化された正本、Markdownをレビュー用の説明とし、矛盾した場合は境界検査をblockにする。成果物には秘密情報、トークン、個人情報、本番データ、未マスクのログを含めない。

各YAMLは`schema_version`と`work_id`を持つ。GitHub Issueを利用する場合は`issue_ref`を必須とし、プロジェクト統制へ接続する場合だけ`project_id`と`feature_id`を追加する。プロジェクト参照は識別と集約に限定し、担当、優先順位、依存関係などプロジェクト側の実行時状態をIssue成果物へ複製しない。

初期実装では、成果物のコミットを一律必須にしない。複数環境で再開する場合は作業ブランチへ保存し、PR作成時の保持・削除方針はプロジェクトで選択する。ただし、検証結果と重要な承認履歴はIssueまたはPRへ残す。

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

状態イベントはIssue内部の監査・再開情報を表し、プロジェクト側は集約用入力として参照できる。ただし、イベントだけからassignee変更、claim取得、次Issueの自動割当を行ってはならない。プロジェクト側が取り込んだイベントのcheckpointを管理し、同じ`event_id`の再処理は状態を重複更新しない冪等な扱いとする。イベントの配送保証、同期方向、競合復旧はIssue #9の責務とする。

### 6.3 再開手順

1. Issue、ブランチ、作業ツリー、remoteとの差分、既存PRを再確認する。
2. YAMLのスキーマ、`work_id`、計画revision、Git参照の整合を検査する。
3. Issueまたは上位ルールの更新を検出し、計画への影響を差分化する。
4. 最後に完了した境界検査を再確認する。
5. `failed`または実行途中の副作用を確認し、冪等性が不明なら自動再実行しない。
6. 人間へ現在地、差分、ブロッカー、次の1ステージを報告して再開する。

正常な中断では、実行中ステージを安全な境界まで戻して`paused`にし、未完了操作と次の作業を記録する。やり直しでは対象ステージとその下流を`pending`へ戻し、計画revision、理由、無効化した成果物を履歴へ記録する。状態ファイルが欠損・破損・古い場合は、Git履歴、Issue、成果物から復元案を作るが、自動で完了状態を推測しない。復元不能な承認は再承認を求める。

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

共通スキーマの実装Issueでは、Issue #9との連携点として`project_id`、`feature_id`、`actor_ref`、`on_behalf_of`、標準状態イベントを定義する。プロジェクトCoordinator、チーム台帳、依存グラフ、claim、自動割当、イベント同期の実装はIssue #9の後続Issueへ分離する。

## 14. 設計承認チェックリスト

- [x] 6機構の目的、入力、出力、状態、適用条件、承認点、失敗時動作が合意されている。
- [x] Issue契約、assignee、`ready-for-ai`、リスク分類、Quality Gatesとの境界が合意されている。
- [x] Issue #9のプロジェクト統制との正本・同期境界と、`project_id`、`feature_id`、`actor_ref`、`on_behalf_of`、標準状態イベントの連携方法が合意されている。
- [x] Markdown＋YAMLの配置、正本、保持方針が合意されている。
- [x] warn/blockと静的検査・AI評価の責務分担が合意されている。
- [x] Security、Privacy、Costの制約が合意されている。
- [x] 後続実装Issueの順序と依存関係が合意されている。

本設計は2026-08-06に明示承認済みであり、後続実装Issueを作成できる。各後続Issueの作成、着手、実装承認は本承認に含めず、個別のIssue契約に従う。
