# Project-level AI Development Orchestration Design

このドキュメントは、`docs/system-context.md`で分割したfeatureを、複数のIssue、開発者、AIエージェントにまたがって計画、割当、追跡するための共通設計を定義する。Issue #8のIssue内部ワークフローを置き換えず、その外側にプロジェクトレベルの統制を追加する。

## 1. 文書の状態

- 状態: 設計承認済み（Issue #9、2026-08-07）
- 承認記録: https://github.com/gorillaimo/ai-driven-dev-template/issues/9#issuecomment-5207242159
- 適用開始: 人間による設計承認後、対応する後続実装Issueが完了した機構から段階的に有効化する
- 現時点の扱い: Project成果物schema v1・記入例・形式テスト、依存DAG・wave・計画改訂とmember/ownership/capacityの読み取り専用validator、手動Coordinatorの手順・コメント様式・机上例は利用可能。明示snapshotの進捗集約・不整合検出も利用可能。実GitHubの自動取得/推薦、Project Golden Test、Dispatcherは後続実装。形式テストとvalidatorのテストを既存ワークフローCIで実行する
- 初期標準: GitHub Issuesを使う手動Coordinator方式
- 任意拡張: GitHub Projects、中央Dispatcher、外部Agent Runner
- 互換性: 1人開発、単一Issue、従来のprompt運用を壊さない追加方式

設計承認前は、この文書だけを根拠としてラベル追加、自動割当、権限変更、Dispatcher実装へ進んではならない。設計承認後も、各後続Issueの契約、assignee、`ready-for-ai`、変更リスク、人間承認を個別に確認する。

## 2. 採用判断

| 論点 | 採用方針 | 理由 |
| :--- | :--- | :--- |
| AI主導の進行 | 人間がセッションを開始し、AIが次の安全な作業を提案する | 常駐・自己起動を前提にせず、promptの選択負荷を減らす |
| 実行時の正本 | GitHub Issue / PR。GitHub Projects採用時はproject fieldを追加 | 複数人が同じ状態を確認でき、チャットや共有YAMLへの分散を避ける |
| 静的な計画 | リポジトリ内のproject成果物 | 依存関係、チーム方針、schemaをレビュー可能にする |
| Issue内部状態 | Issue #8の`.ai-workflow/issues/<work-id>/state.yaml` | 再開地点と工程内履歴をプロジェクト割当から分離する |
| 共有project state | 単一の手編集`state.yaml`は作らない | 並列更新のhot spotと競合を避ける |
| GitHub Projects | opt-in。初期標準では必須にしない | 軽量なIssues-only運用を維持する |
| claim | 手動Coordinatorを初期標準とし、自動化時は中央Dispatcherだけが確定する | 各AIによる自由選択と二重着手を防ぐ |
| stale claim | 警告後に人間が解放・再割当する。自動stealしない | 長時間作業、休日、通信断による誤解放を避ける |
| メンバー確認 | `team.yaml`、GitHub login、repository permission、任意のOrganization Teamの積集合 | プロジェクト役割と実アクセス権を分離して検証する |
| integration owner | area単位を標準とし、Issue単位で上書き可能 | 共有ファイルの責任を明確にしつつ単一人物への集中を避ける |
| 完全自動実行 | 初期リリースに含めない | 権限、費用、障害復旧、監査の運用実績が必要なため |

## 3. 目的と非目的

### 3.1 目的

- 「開発を続けてください」という最小指示から、AIが現在地と次の安全な作業を説明できるようにする。
- feature、Issue、Issue内部ステージ、assignee、claim、branch、PR、blockerを追跡可能にする。
- feature間の依存関係をDAGとして管理し、着手順序と並列waveを決定可能にする。
- 開発メンバー、役割、担当可能area、同時担当上限、integration ownerを機械可読にする。
- 複数人と各自のAIエージェントによる重複着手、共有ファイル競合、責任者不明を防ぐ。
- 手動運用からDispatcher、外部Runnerへ段階的に拡張できる境界を定める。

### 3.2 非目的

- 人間の指示なしにAIが常駐・自己起動すること。
- 人間の承認を省略した仕様決定、自動マージ、自動本番デプロイ。
- AIエージェントやツール名をassigneeまたは開発責任者として扱うこと。
- 全開発者または全AIが単一の共有状態ファイルを更新すること。
- GitHub Projects、Organization Team、特定AIツールを全プロジェクトへ必須化すること。
- Issue #8の適応的計画、再開、追跡性検査、Brownfield解析、Golden Testを再定義すること。
- この設計IssueでDispatcher、Agent Runner、GitHub Actionsを実装すること。

## 4. Issue #8および既存運用との境界

### 4.1 責務

| 対象 | 正本 | 主な更新主体 |
| :--- | :--- | :--- |
| featureの目的・説明・`feature_id` | `docs/system-context.md` | 人間が承認したPR |
| project設定、依存、計画制約、チーム属性 | `.ai-workflow/project/` | Coordinatorまたはintegration ownerのPR |
| Issue契約、assignee、claim、project status、PR | GitHub | 担当者、Coordinator。自動化時は権限を限定したDispatcher |
| Issue内部のstage、再開地点、検証、承認参照 | Issue #8のIssue別成果物 | 当該Issueのprimary agentまたは担当者 |
| project全体の集約表示 | GitHubまたは生成snapshot | 集約処理。手編集しない |

Issue内部の`state.yaml`は再開と境界検査の正本であり、assignee、claim、priority、feature依存を正本として複製しない。project側はIssue #8の`project_id`、`feature_id`、標準状態イベントを読み取れるが、Issue内部stageを独自に完了扱いしない。

GitHub上の集約値とIssue内部状態が矛盾する場合、自動上書きせず対象Issueを`blocked`相当として差分、更新時刻、推奨復旧手順を提示する。

### 4.2 優先順位

競合する指示は次の順で解決する。

1. 人間の停止指示、明示承認、最新の指示
2. Issue契約と非スコープ
3. `AGENTS.md`とalways-onルール
4. 承認済みproject設定と依存制約
5. Coordinatorが確定したassigneeとactive claim
6. AIが生成した次タスク提案

AIの提案は上位の契約、承認、割当、依存を緩和できない。

### 4.3 人間の承認点

| 判断 | 必要な人間の操作・承認 |
| :--- | :--- |
| project設定、team、依存、共有areaの変更 | PRレビューと承認 |
| assignee、active Coordinator、claimの確定 | 初期標準ではCoordinatorまたは人間ownerの明示操作 |
| stale claimのrelease、block override、再割当 | Coordinatorが既存作業を確認して記録 |
| 進行中Issueへ影響する再計画 | 影響IssueのownerとCoordinatorが継続・pause・cancelを判断 |
| High Risk Issueの工程通過 | 当該Issue契約とQuality Gatesが要求する明示承認 |
| Projects、Dispatcher、Runnerの有効化 | 後続Issueで権限、費用、fallbackを承認 |
| merge、deploy、権限変更 | 既存のrepository・環境ルールに従う。AI提案だけでは実行しない |

## 5. Project成果物

利用先では次の配置を標準とする。合成記入例は`.ai-workflow/templates/project/v1/`にあり、公開元に利用先の実設定は作らない。

```text
.ai-workflow/
  project/
    project.yaml          # project識別子、runtime backend、claim・同期方針
    delivery-plan.yaml    # feature参照、依存、area、計画制約
    delivery-plan.md      # 人間向けの生成・レビュー表示
    team.yaml             # project参加者、役割、area、capacity
  issues/
    <work-id>/            # Issue #8が所有するIssue内部成果物
```

### 5.1 `project.yaml`

最低限、次を持つ。

- `schema_version`
- `project_id`
- `runtime_backend`: `issues`または`projects`
- `coordination_mode`: 初期標準の`manual`または後続の`dispatcher`
- manual時のactive Coordinatorまたはarea別Coordinator
- repository参照
- `membership_source`: repository、任意のOrganization Team
- project statusとGitHub label / fieldのmapping
- claimのstale判定、heartbeat、解放方針
- 共有areaと競合方針
- 同期方向、checkpoint、失敗時fallback

初期標準は`runtime_backend: issues`とする。`projects`を選ぶ場合もIssue本文、assignee、claim、PRの正本はGitHub Issue / PRに残し、Project fieldはpriority、wave、project statusなどproject viewの正本として使う。

### 5.2 `delivery-plan.yaml`

最低限、各featureについて次を持つ。

- `feature_id`
- `source_ref`: `docs/system-context.md`の見出しまたはanchor
- `depends_on`: 先行feature ID
- `area_ids`: 主な変更領域
- `planned_priority`: 承認済み計画時点の優先度
- `constraints`: 承認、外部依存、共有areaなど
- `issue_refs`: 作成済みIssueへの参照。未作成を許可する

featureの目的と詳細要件は`docs/system-context.md`を正本とし、`delivery-plan.yaml`へ文章を複製しない。実行時のpriority、assignee、statusはGitHubを正本とし、計画との差分だけを再計画理由として記録する。

`delivery-plan.md`はYAMLとGitHubから生成できる人間向け表示とする。手編集内容を正本にせず、生成時刻と入力revisionを表示する。

### 5.3 `team.yaml`

次は運用属性の概略であり、完全なschema v1記入例ではない。実際のheader・方針は`.ai-workflow/templates/project/v1/team.yaml`を参照する。

```yaml
schema_version: 1
project_id: example-app
membership_source:
  type: repository
members:
  - github_login: example-user
    active: true
    roles: [developer]
    areas: [backend]
    max_concurrent_issues: 1
    integration_owner: [backend]
```

- `github_login`: 人間のGitHubアカウント。AI名やツール名を入れない。
- `active`: project内で新規割当を受けられるか。
- `roles`: coordinator、developer、reviewerなど。
- `areas`: 担当可能な変更領域。
- `max_concurrent_issues`: active claimの上限。
- `integration_owner`: 統合判断を担当するarea IDの配列。

メールアドレス、端末識別子、token、秘密情報、勤務状況などの個人情報は保存しない。休暇や一時離脱は`active: false`と既存claimの引き継ぎ記録で扱う。

### 5.4 共有project stateを作らない

全エージェントが更新する`.ai-workflow/project/state.yaml`は作らない。project状態はGitHubから取得し、必要な集約結果はCI artifact、ローカル一時ファイル、生成Markdownとして作成する。生成物をコミットする場合も手編集を禁止し、入力revisionと生成時刻を持たせる。

### 5.5 実装済みのProject schema v1

`.ai-workflow/schemas/project/v1/{common,project,delivery-plan,team}.schema.json`を正本とする。
URNは`urn:ai-workflow:project:v1:<name>`。Draft2020-12をローカル登録し、既存`urn:ai-workflow:issue:v1:common`のactor/login/timestamp/reference/approval/IDを参照する。
Issue用envelope自体を流用せず、Project headerにはschema_version、artifact_kind、project_id、revision、updated_at、updated_byを持つ。
artifact_kindはproject/delivery_plan/team。project_idは小文字英数字とhyphen、1〜128文字で、feature/area IDは既存commonの形式を使う。
既存Issue schemaは変更せず、Project参照のない従来の単一Issueも維持する。schema_versionとtemplate release versionは独立。

初期の受理集合はruntime_backend:issues、coordination_mode:manualに限定する。第5.1節のProjects/Dispatcherは将来設計であり、v1では有効化・受理しない。
project.yamlはrepository（owner/name）、template_origin（HTTPS repository URL/SemVer/40桁commit）、coordinators、membership_source、required_repository_permission、status_mapping、claim_policy、areas、sync_policyを持つ。
coordinators.scopeはproject/area。project全体ならassignment1人・area_ids空、area別なら各assignmentにarea IDを1件以上指定する。
membership_source.typeはrepositoryで、Organization Teamはnull/省略またはorganization/team_slug。required_repository_permissionはread/triage/write/maintain/adminの方針値。
status_mappingは第7.1節の8値からlabel名へ対応させる。ready-for-aiと別であり、実ラベルの存在は確認・作成しない。
claim_policyはheartbeat_interval_seconds/stale_after_secondsの正整数、on_stale:warn、release_policy:manual。秒数の相互関係や実claimの状態は後続検査。
areasはarea_id/paths/shared/integration_owner/conflict_policyを持ち、shared:trueならowner login必須。pathsは相対path/prefix、conflict_policyはserialize/disjoint_scopesで、glob解釈は行わない。
sync_policyはgithub_to_snapshot/event_id/manual_reviewの静的方針であり、実checkpointは保存しない。

各featureにはfeature_id/source_ref/depends_on/area_ids/planned_priority/constraints/issue_refsが必要。
source_refはdocs/system-context.mdと明示fragment。depends_onはfeature_idとreasonのobject配列。planned_priorityは正整数で小さいほど先とする。
constraintsはkind/reference/reasonを持ち、kindはapproval/external_dependency/shared_area。shared_areaだけはarea_idも必須。
issue_refsはissue_ref/work_id/requiredのobject配列。未作成なら空、1featureに複数Issueを許可する。
delivery planのrevision_historyはrevision/reason/既存approval/affected_feature_ids/invalidated_wavesを持ち、初回は空。
実行時priority/status/assignee/claim、計算済みwaveや要件本文を静的台帳へ複製しない。

team.yamlは共通header、membership_source、members。memberはgithub_login/active/roles/areas/max_concurrent_issues/integration_ownerを持つ。
rolesはcoordinator/developer/reviewer、capacityは整数1以上、integration_ownerはarea ID配列。メール・勤務情報・端末・token等のcore追加は禁止する。
空のfeature/member/area一覧は初期記入として受理するが、割当可能や計画完成を表さない。coreの未知fieldは拒否し、独自メモはtop-level extensionsだけに置く。

`npm run test:project --prefix tools/workflow-schema`は同梱schema/記入例/fixtureの形式検査。既存依存だけを使い、既存Workflow ValidationのNode22/24で実行する。
正常・異常case、厳密YAML、決定性、入力非変更、外部呼出し/command非実行、cold5秒目標を確認する。診断はkind/instancePath/schemaPath/keywordで、値を転載しない。
意味validatorやProject Golden Testではなく、利用先の保存Projectファイルを走査するruntime checkerも提供しない。
形式適合はDAG/一意性/横断ID/member照合/権限/本人性/capacity/承認/履歴連続性/参照実在を保証しない。後続validator・人間レビューで確認する。
記入例の同一project/area/member対応はサンプル整合としてテストするが、任意入力の横断検査ではない。
未知version・破損時は元データを保持し、従来のIssue/assignee/着手コメント/branch/PR運用へ戻す。

## 6. 識別子と追跡性

### 6.1 識別子

- `project_id`: repository内で一意かつ不変。小文字英数字とhyphenを使う。
- `feature_id`: project内で一意かつ不変。名称変更後も再利用・変更しない。
- `work_id`: Issue #8の作業ID。GitHub利用時はIssue番号へ解決可能にする。
- `claim_id`: claim試行ごとに一意。再割当時は新しいIDを発行する。
- `area_id`: 共有境界、所有、競合判定に使う安定ID。

削除したIDを別のfeatureやareaへ再利用しない。表示名、Issue title、担当者が変わってもIDは維持する。

### 6.2 追跡関係

少なくとも次を相互参照できるようにする。

```text
project_id
  -> feature_id
    -> issue_ref / work_id
      -> current_stage
      -> assignee / claim_id
      -> branch / PR
      -> blocker / approval
```

1つのfeatureに複数Issueを許可する。feature完了は、必須Issueがすべて完了し、未解決blockerがなく、feature単位の受け入れ条件が確認された場合だけとする。調査Issue、prototype Issue、設計Issue、実装Issueを同じfeatureへ関連付けても、個別の完了をfeature全体の完了と誤認しない。

## 7. 状態モデル

### 7.1 Issueのproject status

機械可読値は次を標準とする。

```text
draft -> available_for_work -> assigned -> in_progress -> in_review -> completed
                    \-> blocked -----------/            \-> cancelled
```

- `draft`: 契約または依存が未確定。
- `available_for_work`: 契約、依存、承認準備が揃い、Coordinatorが割当可能。
- `assigned`: 人間のassigneeが確定し、まだactive claimがない。
- `in_progress`: active claimと作業branchがある。
- `blocked`: 依存、承認、競合、権限、障害により進められない。
- `in_review`: PRまたは設計承認のレビュー中。
- `completed`: Issue契約と必須検証を完了。
- `cancelled`: 人間が終了した終端状態。

`ready-for-ai`はAIへ依頼可能な契約品質を表す既存ラベルであり、project status、assignee、claimを意味しない。

### 7.2 feature status

- `planned`: featureと依存を定義済み。
- `ready`: 先行featureが完了し、必須Issueを割当可能。
- `active`: 関連Issueのいずれかが`assigned`、`in_progress`、`in_review`。
- `blocked`: 必須Issueまたはfeature依存がblocked。
- `completed`: 必須Issueとfeature受け入れ条件を完了。
- `cancelled`: 人間が計画から除外。

feature statusはGitHub上の関連Issueから集約する。手編集でIssue状態と矛盾させない。

### 7.3 Issue内部stage

requirements、design、tests、implementationなどのstageはIssue #8の`current_stage`を参照する。project statusとstageを1つの値へ統合しない。例えば、project statusが`in_progress`、current stageが`design`という組み合わせを許可する。

## 8. 依存関係、開発順序、wave

### 8.1 DAG

feature依存は`depends_on`の有向辺で表し、自己参照、未知ID、循環をblockする。循環を検出した場合、AIは順序を推測せず、循環経路と分割・境界変更の候補を人間へ提示する。

依存には理由を記録する。代表例はAPI契約、共通データモデル、認証基盤、共有UI、Infrastructure、walking skeleton、外部承認である。「念のため」の依存を増やさず、成果物または契約上の先行条件がある場合だけ設定する。

### 8.2 wave計画

基本waveはtopological orderから決定する。

- 依存を持たないfeatureを最初のwave候補とする。
- featureのwaveは、未完了の依存featureより後にする。
- 同じwaveでも共有area、capacity、integration ownerの制約が衝突する場合は直列化する。
- walking skeletonや共通契約は明示的なfoundation featureとして先行させる。
- 外部依存や人間承認待ちはwaveへ含めず`blocked`として分離する。

waveは計画上の並列可能性であり、自動着手命令ではない。Coordinatorがassignee、claim、変更scopeを確定したIssueだけが実行される。

### 8.3 再計画

依存、priority、scope、area、feature追加・取消が変わった場合はplan revisionを増やし、変更理由、承認者、影響feature、無効になったwaveを記録する。進行中Issueを黙って別waveへ移動せず、継続、pause、cancelの判断を人間へ求める。

### 8.4 実装済みの依存・wave・改訂validator

`tools/workflow-project/`の`checkProjectPlan({project, deliveryPlan, context, previous?})`はJSONデータを受ける読み取り専用関数。
`loadProjectPlan(root, paths)`は明示したcurrent/previousのproject・deliveryPlan・contextだけを厳密YAML/JSONとして読む。
既存Project schema v1とIssue共通定義を変更せず再利用する。context/resultの正本は`.ai-workflow/schemas/project-plan-checks/v1/`、URNは`urn:ai-workflow:project-plan-checks:v1:<name>`。
自動探索・Git/GitHub照会・clock・外部AI・入力commandの実行・書込みは行わない。

contextはproject_id、project_revision、plan_revision、project_digest、plan_digest、observed_at、recorded_by、source、feature_facts、constraint_facts、replan_decisionsを持つ。
digestは原文ではなく、コメント除去後のJSONデータを既存canonical関数で直列化したSHA-256。署名ではなく、確認記録と対象入力の一致を識別する。
feature_factsには各featureをちょうど1件記録し、stateはplanned/active/completed/blocked/cancelled/unknown。
active/completed/blocked/cancelledはevidence必須。constraint_factsはfeature_idと0始まりconstraint_indexで対象を指定し、satisfied/pending/unknown。satisfiedはevidence必須、省略はunknown。
recorded_byは既存actor形式で、AI/botには人間のon_behalf_ofが必要。これらは提出者の確認記録であり、本人性・実権限・参照実在・完了の自動集約・鮮度を認証しない。

検査順は入力上限→schema→識別とdigest→全featureのDAG→確認記録→history→改訂影響→wave。
重複feature/area/依存/Issue、未知ID、自己依存、空白の理由、循環、共有constraintとareaの不一致をblockする。
Issue URLはgithub.comのproject.repositoryに属し、番号とwork_idが一致する必要がある。未作成の空配列は許可するが、実Issueの存在を保証しない。
循環経路は反復式DFSで決定的に示す。完了・取消featureも構造検査から除外しない。

waveはplanned_priority昇順→feature_idのASCII順で、各回の依存を満たす候補を安定して詰める。
planned依存は先行waveへ置く。completedは再投入しない。active/cancelledは別表示し、blocked/unknown/未解決constraint/activeとのarea競合とその下流は待機する。
areaの同一/祖先子孫pathが重なる変更は、非sharedでも保守的に直列化する。src/apiとsrc/api2は重複しない。
disjoint_scopesの証拠は未評価で、指定だけから並列許可を作らない。serializationには後回しにした理由の代表となる競合feature/areaを記録する。
dependency_candidatesは最初のwave内で全先行featureがcompletedのものだけ。Issueの割当・着手候補を自動確定しない。
空計画は形式適合しても候補なし・empty_plan未評価。進行中featureを新waveへ移動しない。

初期revisionは1、historyは空。以後のhistoryは2から現revisionまで昇順で追記する。
revision>1には直前snapshotが必要。同revisionの再検査は同じ計画原本の場合だけ許可し、確認snapshotだけの更新を許す。
改訂は直前plan revisionから+1。project変更にはproject revisionの増加、area変更にはplan revisionの増加も必要。
previous自体の形式・識別・DAG・facts・historyを検査し、旧waveを再計算する。古い結果JSONを根拠にしない。
変更feature、旧新グラフの下流、競合areaのpeerとその下流を影響集合へ含める。priority変更は全featureへ保守的に広げる。
最新historyは影響IDと旧waveを包含し、余分な既知ID/waveの無効化は許可する。削除featureは旧IDのまま記録し、過去historyを改変しない。
影響する旧/現activeにはreplan_decisionsのcontinue/pause/cancelと既存approvalを要求する。記録があっても実状態を変更せず、旧activeをplannedへ戻した再配置はblockする。
直前より古い原本の真正性や削除ID再利用の完全監査は保証しない。

結果はschema_version、checker_version、input_digest、対象revision/digest、observed_at、status、checks、diagnostics、waves、dependency_candidates、waiting、active/completed/cancelled、serialization、revision_impact、not_evaluatedを持つ。
status:passは提出入力の検査成功だけ。待機featureがあっても無関係な計画可能featureを表示できる。構造等がblockedならwaves/candidatesは空。
diagnosticsは安定code・構造path・安全なID・閉じた循環経路だけ。自由記述理由、evidence本文、extensionsを転載しない。文言はmessages.mjsへ集約する。
not_evaluatedは権限/member/capacity、参照実在、承認本人性、snapshot鮮度、feature完了集約、全過去原本、非重複scopeを常に明示する。
結果は呼出元が一時snapshot/CI artifactへ保存できるが、共有Project stateとして手編集せず、次回も元入力から再検査する。

上限は1file 1 MiB、current/previous合計5 MiB、JSON深さ32/200000node。
各snapshotはfeature1000、area200、依存辺/constraint/Issue参照/featureのarea参照/areaのpath各総数10000、history100、history内影響ID/wave各総数10000。
diagnostic1000・結果1 MiB。診断の蓄積にもbyte予算を設け、超過は打切りblock。1000feature/10000edgeのcold実行目標5秒（依存取得除外）を合成例で検証する。
schema、決定性、非変更、通信/command非実行、境界、改訂・待機を専用テストで確認する。これは後続のProject Golden Testや実プロジェクト導入試験の代替ではない。
結果のpassや候補はassignee/claim/承認/着手の代替ではない。member、ownership、capacity、実参照、全過去原本の監査は別途確認する。

## 9. メンバー確認と割当可能性

### 9.1 現在の人間を識別する

AIは作業開始時に、利用中のGitHub認証からloginを取得し、次を確認する。

1. `team.yaml`に同じ`github_login`があり`active: true`である。
2. repositoryにproject方針が要求するpermissionがある。
3. Organization Teamを設定した場合はactive memberとして確認できる。
4. Issueのassigneeまたは依頼コメントの人間と作業依頼の関係が説明できる。

確認APIや権限が利用できない場合、自動割当はblockし、人間が確認したGitHubコメントへの参照を記録する。membershipを推測しない。

開発者本人のcredentialを使うinteractive modeでは、認証中loginを人間ownerとして扱う。共有bot credentialを使う場合、botを`team.yaml`の開発メンバーやassigneeにせず、Dispatcherまたは人間の依頼記録から`on_behalf_of`のGitHub loginを受け取り、その人間についてmembership、permission、assigneeを検証する。`on_behalf_of`を確認できないbot作業はblockする。

### 9.2 実効メンバー

- Organization Teamを設定しない場合: `team.yaml`のactive memberかつ必要なrepository permissionを持つ人間。
- Organization Teamを設定する場合: `team.yaml`、Organization Team、repository permissionの条件をすべて満たす人間。
- Organization Teamに所属していても`team.yaml`にいない人間は、このprojectの自動割当対象にしない。
- `team.yaml`でactiveでもTeam所属またはpermissionを失った人間には新規割当しない。

不一致は自動修正せず、Coordinatorへ差分を報告する。

### 9.3 割当候補

候補者は、active membership、role、area、capacity、既存claim、休止状態、integration owner制約を満たす必要がある。AIは候補と根拠を提示できるが、初期標準ではCoordinatorがassigneeを確定する。

### 9.4 実装済みのmember・ownership・capacity検査

`tools/workflow-project/members.mjs`の`checkProjectMembers({project, team, context})`は、指定人間1人について提出snapshotと台帳の整合を読み取り専用で検査する。
`loadProjectMembers(root, paths)`はproject/team/contextの明示pathだけを厳密YAML/JSONとして読む。
新しいcontext/resultは`.ai-workflow/schemas/project-member-checks/v1/`、URNは`urn:ai-workflow:project-member-checks:v1:<name>`。
既存Project/Issue schemaと計画checkerは変更しない。canonical/digest/JSON境界・area重複の規則を既存libraryから再利用する。
Git/GitHub・clock・環境変数・外部AI・入力commandの実行・書込み・自動探索は行わない。

contextは次を持つ。すべてデータの申告であり、実認証やGitHubの実状態の保証ではない。

| 項目 | 契約 |
| :--- | :--- |
| project_id/repository、project_revision/team_revision、project_digest/team_digest | 対象台帳との一致。digestはコメントを除いたJSONデータのcanonical SHA-256で署名ではない |
| observed_at/evaluated_at/freshness_limit_seconds | 呼出元の明示時刻で比較。制限は1～86400秒、デフォルトなし。未来・期限超過・台帳更新前の確認は停止 |
| recorded_by/source | 既存actor/reference。ai_agent/botはon_behalf_of必須 |
| principal | credential_kind、authenticated_login、on_behalf_of、evidence、delegation（confirmed/denied/unknownとevidence） |
| request | mode、issue_ref/work_id/human_owner、area_ids、assignees、responsibility_confirmation、owner_overrides |
| member_facts | github_login、account_type（human/bot/unknown）、evidence、repository_access、organization_team |
| claims_inventory_status/active_claims | complete/partial/unknownと、claim_id/issue_ref/work_id/human_owner/evidenceの最小投影 |

GitHub login・repository・Organization名はASCII小文字化して照合し、大小文字違いの重複を別人にしない。台帳は書き換えない。
membership_sourceのTeam省略/nullは同等。それ以外はproject/teamのorganization/team_slug一致が必要。area IDは既存の安定IDをそのまま使う。
全area参照、member/area/factの重複・未知ID、Coordinatorの登録/active/coordinator role、既定integration ownerの双方向宣言を検査する。
area scopeのCoordinatorは全areaを一意に覆い、member.areasにも対象を持つこと。別Coordinatorの同一/祖先子孫path重複は停止する。
project scopeのCoordinatorは調整役なのでmember.areasの全域化を要求しない。
既定ownerはactive memberで対象areaをmember.areasとintegration_ownerに持つ必要がある。sharedで必須、非sharedの指定も照合する。
inactive memberは保持できるが、新規担当から除外する。Coordinator/既定ownerのinactiveは設定の見直しが必要。

対象人間・要求areaに必要なCoordinator・有効な統合責任者の外部factsを評価する。無関係なmemberのfactsを全件取得することは要求しない。
repository_accessはstate（confirmed/denied/unknown）とpermission、肯定時evidence。read < triage < write < maintain < adminの明示順を使い、未知custom permissionを推測しない。
Organization Team採用時はstate:memberと設定のorganization/team_slug、evidenceが必要。not_memberとunknownを区別し、Team未採用なら所属を要求しない。
APIが使えない場合は人間の確認コメント等の参照を記入できるが、それもなければunknownで停止する。evidenceやfact自体の真正性は検査しない。

human credentialではauthenticated_loginとrequest.human_ownerが一致すること。botは別の認証主体として記録し、on_behalf_ofと確認された代理依頼参照を要求する。
botのauthenticated_loginを人間のteam memberとして兼用しない。責任者不明・代理拒否・確認不足を診断で区別する。
対象人間はactiveな登録human、developer role、要求する全areaを担当できることが必要。role名から実権限を補わない。
candidate modeはその人の新規担当条件を検査するだけで、他人の選択・順位付けを行わない。既存の別assigneeを無視しない。
assigned_owner modeはprimary human_ownerがassigneesに含まれ、責任・依頼関係のconfirmed参照が必要。追加assigneeを別のprimaryとして数えない。
Issue URLはgithub.comの対象repository、work_idはissue-Nとして一致させるが、実在を取得しない。要求areaは1件以上。

Issue別の所有上書きはrequest.owner_overridesへ一元化し、area_id/github_login/issue_ref/work_id/approvalを持つ。
対象Issue/work/要求areaとの一致、二重指定なし、当該areaのactive Coordinatorがapproved_byであること、approval_type:integration_owner_override、観測時点より未来でない承認時刻を要求する。
上書き先もactiveな人間で、対象areaとmembership/permission/必要Teamの条件を満たすこと。既定team宣言は変更せず、そのIssueの有効ownerとして返す。
承認者の宣言は照合するが、コメント本人性・実承認・実権限の認証は行わない。

capacityはcompleteと申告されたactive claim inventoryだけから計算し、partial/unknownなら空配列でも上限内としない。
claim/Issue/work IDの重複、別repository、未登録ownerを拒否し、重複を黙って捨てない。inactive・stale・paused・blockedでも解放が確認されるまではinventoryへ残す。
新規担当は本人の現在active数+1がmax_concurrent_issues以下。assigned_ownerで同じIssueの本人claimがあれば追加0。別人のclaimは停止する。
candidateで対象Issueにclaimがあれば本人分でも新規候補にせず、再開は既存Issue checker/人間へ戻す。Coordinator/統合責任という役割だけでは担当数を加算しない。
呼出しによってclaimや担当数を書き換えず、繰り返しても枠を消費・解放しない。

結果はschema_version/checker_version、input_digest、対象revision/digest、観測/評価時刻、status/checks、subject、coordinators、integration_owners、capacity、diagnostics、not_evaluated。
status:passとsubject.qualification:eligibleは必要な全検査がpassの場合だけ。必要事実がunknownまたは入力不正ならunknown、既知の不足だけならineligible。いずれも担当確定・着手権ではない。
capacityはactive_count/additional_count/limit。入力不正やinventory不明では計算を推測せずnullにする。
診断はcode/kind/構造path/安全なlogin・area IDだけで、evidence本文やextensions・秘密値を転載しない。文言はmember-messages.mjsへ集約する。
not_evaluatedはGitHub/証拠真正性、実時刻/inventory全量の真正性、契約/ready-for-ai/工程承認、DAG/依存、実scope競合、原子的claim、実作業を明示する。
出力を次回のpassの証拠として再利用せず、元入力から再検査する。共有Project stateを新設しない。

上限は1file 1 MiB、合計5 MiB、JSON深さ32/200000node、member/fact/Coordinator登録1000、area/要求area/override200、active claim10000。
area path/member-area/member-owner/Coordinator-area各参照総数10000、診断1000/結果1 MiB。過大な診断も打切りblockする。
1000member/200area/10000claimの直接API用合成fixtureでcold5秒目標（依存取得除外）を検証する。file loaderの1file上限は別途適用する。
Node22/24の専用テストは既存Workflow Validationへ接続する。Project全体Golden、実案件の認証・membership取得の自動化、自動割当は後続対応である。手動割当は第10.6節の手順を参照する。

## 10. Coordinator、claim、競合防止

### 10.1 手動Coordinator方式

初期標準では、`roles`に`coordinator`を持つ人間が次を行う。

1. 依存、契約、`ready-for-ai`、承認準備を確認する。
2. area、capacity、既存作業から担当候補を選ぶ。
3. GitHub assigneeを設定する。
4. change scope、非担当領域、integration ownerをIssueまたは着手コメントへ記録する。
5. active claimを記録し、project statusを`in_progress`へ進める。
6. 完了、release、block、再割当を記録する。

各開発者のAIは、自分の依頼元の人間へ割り当てられたIssueだけを実行する。未割当Issueを提案することはできるが、自分でassigneeやclaimを確定しない。

manual modeでは、project全体または互いに重ならないareaごとにactive Coordinatorを1人だけ指定する。複数Coordinatorを登録しても、同じIssueまたは同じ共有areaの割当操作を同時に行わない。交代時は、GitHubへhandoff時刻、未完了の割当操作、active claimを記録してからactive Coordinatorを変更する。

1つのIssueには責任を持つ人間ownerを1人定める。GitHub上で複数assigneeを許可する場合も、claimの`human_owner`は1人とし、追加参加者はreviewerまたは明示された協力者として扱う。

### 10.2 claim記録

claimには少なくとも次を持たせる。

- `claim_id`
- Issue / `work_id`
- 人間のowner GitHub login
- 利用するAIツールまたはagent識別子。責任者としては扱わない
- branch
- 変更可能area / file scope
- 非担当領域
- primary agentまたはintegration owner
- `claimed_at`
- `last_heartbeat_at`
- stale判定時刻またはproject設定への参照

GitHub Issueコメントを標準記録場所とする。再割当時は旧claimを編集して消さず、releaseまたはsupersededの記録と新しい`claim_id`を追加する。

### 10.3 stale claim

初期標準では、project設定の`claim_policy.stale_after_seconds`超過は警告であり、自動解放しない。Coordinatorは担当者、branch、PR、直近eventを確認し、次のいずれかを記録する。

- heartbeatを更新して継続する。
- `paused`または`blocked`として保持する。
- claimをreleaseし、作業treeと引き継ぎ情報を確認して再割当する。
- 不明な変更があるため再割当を停止する。

自動Dispatcherを導入する場合も、期限切れを直接stealせず、reconciliation状態を経てから再割当する。

### 10.4 共有area

`docs/system-context.md`、`docs/architecture.md`、OpenAPI、共通schema、共通型、lockfile、認証、Infrastructureなどを共有areaとして登録できる。共有areaを変更するIssueにはintegration ownerを必須とし、次のいずれかを選ぶ。

- foundation Issueとして先にmergeする。
- 変更scopeが重ならないよう分割する。
- 同じintegration ownerが順序を決めて直列化する。
- 共通変更を専用Issueへ切り出す。

`CODEOWNERS`はレビュー責任を表すが、claimや排他制御の代替ではない。assigneeはIssue責任、claimは着手権、integration ownerは共有areaの統合責任を表す。

### 10.5 1つのIssueを複数AIで扱う場合

Issue内部の並列化は既存のマルチエージェント規約に従い、人間の承認、primary agent、担当scope、変更可能ファイル、非担当領域を必須とする。project CoordinatorはIssueを1つの割当単位として扱い、内部sub-agentを別メンバーや別assigneeとして数えない。

### 10.6 利用可能な手動運用手順とコメント様式

実操作は[manual-coordinator.md](manual-coordinator.md)、6種のMarkdownは[project-manual/v1](../../.ai-workflow/templates/project-manual/v1/README.md)、机上検証は[walkthrough](../examples/project-manual/walkthrough.md)を参照する。
割当、claim開始、heartbeat/pause/block/resume/review、解除、Coordinator交代、部分失敗の照合を人間が追記する。
着手と解除は準備/依頼と確定を区別する。旧作業の停止・未push/引継確認と旧解除確定前に新claimを開始しない。
paused/blocked/in_review/inactive/staleでも解除確定までcapacityへ含め、無関係なコメントやPR更新をheartbeatへ補完しない。
8statusはstatus_mapping先labelで手動表示し、ready-for-ai/assignee/内部stage/open・closedとは区別する。label不整合や部分失敗では新規割当・着手を保留し、元操作IDと現状を人間が照合する。
同Issue/共有areaの操作担当は1人。複数areaでは関係Coordinatorが合意し、交代は旧担当停止・引継受領・設定PR反映を確認して切り替える。
コメント様式v1は人間向けの版でschema_versionではなく、parser/reducerや自動冪等性・原子的claim・自動stale解放を提供しない。
机上確認はライブ同時操作やAPI障害復旧の実証ではない。集約/reconciliationの自動実装、推薦、Project全体Goldenは後続Issueとする。

## 11. AI主導の次タスク提案

### 11.1 トリガー

AIは常駐せず、人間がセッションで「開発を続けてください」などの最小指示を与えた時点をトリガーとする。イベント駆動の自動起動には、後続の外部Agent RunnerまたはGitHub Actionsと明示的な権限設計が必要である。

### 11.2 入力

- 認証中のGitHub login、または検証済みの`on_behalf_of`。
- `project.yaml`、`delivery-plan.yaml`、`team.yaml`の承認済みrevision。
- GitHubのIssue契約、assignee、status、claim、branch、PR、承認記録。
- Issue #8の`current_stage`、blocker、次に許可されたstage、状態event。
- feature依存、wave、priority、area競合、member capacity。
- 人間の最新指示、停止指示、override。

### 11.3 選択手順

AIは次の順で判断する。

1. 認証中のGitHub loginと実効メンバー条件を確認する。
2. 自分の依頼元の人間に割り当てられた`in_progress` Issueを探す。
3. active claimがある場合、Issue #8の再開手順で安全な次stageを提案する。
4. `assigned` Issueがある場合、依存、承認、競合、capacityを再確認してclaim開始を提案する。
5. `blocked`または`in_review`しかない場合、勝手に別Issueへ移らず、blockerまたはレビュー待ちを報告する。
6. 割当Issueがない場合、Coordinator向けに`available_for_work`候補をpriority、wave、Issue番号の安定順で提示するが、初期標準では自動claimしない。

同順位の候補は、明文化されたpriority、wave、依存解除時刻、Issue番号など決定的なtie-breakで並べる。AIの主観だけで順序を変更しない。

人間owner本人が自分に割り当てられたIssueについて最小指示を行った場合、その指示をclaim開始の依頼として扱える。AIは着手条件を再検査し、claimコメントとIssue branchを作成する前に、対象Issue、scope、競合の有無を短く報告する。未割当Issue、他人がownerのIssue、共有botで`on_behalf_of`を確認できない場合は、最小指示だけでclaimを開始しない。

### 11.4 出力

AIは次を短く提示する。

- project、feature、Issue、current stage、assignee、claimの現在地。
- 選択した次の1作業と選択理由。
- 満たした依存、承認、capacity、競合検査。
- 作成・更新しようとするclaim、branch、成果物。
- 人間の承認が必要な判断、blocker、未確認事項。
- 選択できない場合は上位候補と除外理由。

### 11.5 停止条件

- assignee、claim、membership、permissionを確認できない。
- High Riskの必要承認がない。
- 依存featureまたはIssueが未完了。
- change scopeが既存claimまたは進行中PRと競合する。
- GitHubとIssue内部stateが不整合。
- feature ID、Issue契約、受け入れ条件が不足する。
- 人間が停止、pause、priority変更を指示した。

停止時は、理由、影響、確認先、再開条件を提示する。

## 12. 自動DispatcherとAgent Runner

### 12.1 Dispatcher

自動割当を導入する場合、各AIがGitHubから自由にIssueを選ぶ方式は採用しない。中央Dispatcherをclaim確定のsingle writerとし、同一repository / projectの割当処理を直列化する。

Dispatcherは次を満たす。

- requestごとのidempotency key。
- 同じIssueにactive claimがないことの再確認。
- assignee、membership、permission、capacity、依存、競合の検査。
- GitHub更新の部分失敗を検出するreconciliation。
- 監査eventと人間ownerの`on_behalf_of`記録。
- 停止、手動override、read-only fallback。

原子的なclaimはDispatcherの直列化・永続化境界で保証し、複数の独立AIによるGitHub更新のタイミング一致へ依存しない。

### 12.2 Agent Runner

RunnerはDispatcherが確定したclaimだけを受け取り、指定Issue、branch、scope、人間ownerを実行contextへ渡す。Runner障害時に自動で別Issueへ移らず、同じclaimの再開または人間によるreleaseを待つ。

初期リリースではRunnerを含めない。導入には権限、sandbox、secret、費用、timeout、停止方法、監査、同時実行上限の別設計と明示承認を必要とする。

## 13. 同期と復旧

### 13.0 読み取り専用集約の契約

`aggregateProject({project,deliveryPlan,context,workflows,checkpoint?})`は、明示されたGitHub確認snapshotと既存Issue checkerの元入力を集約する。`loadProjectAggregate(root,paths)`は列挙pathだけを読む。通信・Git/command・状態更新・自動保存を行わない。
独立した`project-aggregate/v1`のcontext/checkpoint/resultを使い、既存schema・checkWorkflow・ProjectのDAG検査を再利用する。人間向けMarkdown様式を機械契約へ変換しない。
観測値と照合結果を区別し、欠損・古い/partialな取得・未知事実を完了へ昇格しない。必須Issueとfeature ACの人間受け入れ、依存・制約・optional作業を考慮してfeatureを集約する。
managed Issueは既存checkWorkflowを再実行する。通常のresume停止を履歴破損と混同しない。legacyの内部工程は未評価とする。
checkpointはIssue/workごとの履歴順event ID/digestの生成記録であり、再読込の二重計上を防ぐ。履歴prefix改変/短縮や別revisionへの暗黙移行を拒否し、元入力の再検査を省略しない。実GitHubやcheckpointの真正性は未評価。
詳細な利用・記入はoperations-manualのProject集約節、全フィールドはproject-aggregate/v1のschemaと合成fixtureを参照する。入力5 MiB、1file1 MiB、深さ32/200000node、100Issue、履歴計10000、診断1000/結果1 MiBを上限とし、100Issue代表fixtureでcold5秒を目標に検証する。

### 13.1 同期

- project設定の変更はPRでレビューする。
- GitHub runtime状態をproject YAMLへ書き戻さない。
- Issue #8の状態eventを集約する場合、`event_id`ごとのcheckpointを持ち冪等に処理する。
- Project fieldやlabelを投影する場合、同期元、同期先、更新時刻、revisionを記録する。
- 双方向同期を初期標準にせず、fieldごとに一方向のownerを1つ決める。

### 13.2 復旧表

| 状況 | 動作 |
| :--- | :--- |
| duplicate event | checkpointで無視し、同じ結果を返す |
| GitHub更新の部分失敗 | claim確定を保留し、差分をreconciliation対象にする |
| stale claim | 自動stealせず、担当者・branch・PRを確認する |
| 担当者の離脱 | `active: false`、既存claimのpause/release、引き継ぎ記録を行う |
| branchはあるがclaimがない | orphan候補としてblockし、所有者を確認する |
| claimはあるがbranchがない | 作業未開始か削除かを確認し、勝手に再作成しない |
| dependencyが失敗・取消 | 下流をblockし、代替依存または再計画を承認する |
| GitHubとIssue内部stageが不一致 | 自動上書きせず、更新時刻と根拠を比較して人間が解消する |
| Dispatcher停止 | 新規自動割当を止め、既存claimは維持し、手動Coordinatorへfallbackする |
| GitHub API rate limit | cacheとbackoffを使い、最新性を確認できない割当は停止する |

復旧不能でも従来のIssue、assignee、着手コメント、branch / PRによる手動運用へ戻れることを必須とする。

## 14. GitHub ProjectsとGitHubを使わない場合

### 14.1 Issues-only

初期標準。Issue本文、assignee、labels、claimコメント、branch、PRを使う。導入が軽い一方、feature横断の一覧は生成reportまたは検索で補う。

### 14.2 GitHub Projects opt-in

多数feature、複数team、portfolio表示、custom fieldによるpriority / wave / project statusが必要な場合に採用する。`project.yaml`で`runtime_backend: projects`を明示し、field IDとmappingを設定する。利用不能時に暗黙でIssues-onlyへ切り替えず、read-only表示または人間承認付きfallbackを使う。

### 14.3 GitHubを使わない場合

作業管理ツールに、Issue、assignee、claim、status、review、stable ID、監査eventに相当する機構があることを確認する。原子的claimを提供しない場合は手動Coordinatorを使う。ツール名だけを置き換え、責務境界と停止条件を緩和しない。

## 15. Security、Privacy、NFR、Resiliency

| Gate | 設計時点の判定 | 後続実装で確認すること |
| :--- | :--- | :--- |
| NFR | 未確認あり | 対象Issue数、応答時間、API call数、rate limit時の目標値 |
| Security | 方針確認済み・実装未確認 | token scope、bot権限、Organization Team確認権限、監査情報の公開範囲 |
| Resiliency | 方針確認済み・実装未確認 | claimの部分失敗、checkpoint永続化、reconciliation、manual fallbackの実動作 |

### 15.1 Security / Privacy

- AIは認証中のloginとpermissionを検証するが、tokenやcredentialを成果物・コメントへ出力しない。
- `team.yaml`にはGitHub loginとproject運用属性だけを保存し、メール、端末、勤務情報、秘密情報を保存しない。
- bot / Dispatcher / Runnerは最小権限とし、read、claim更新、PR操作、merge、deployの権限を分離する。
- AIエージェントやbotによる更新は`actor_ref`と人間ownerの`on_behalf_of`を記録する。
- fork PRや信頼できない入力へsecretを渡さない。
- 生成結果だけで承認、merge、deploy、権限変更を行わない。

### 15.2 NFR

- API取得は必要なIssue、field、期間へ限定し、cache、pagination、rate limit、backoffを設計する。
- 大規模projectではfeature、area、waveで集約範囲を限定できるようにする。
- 集約結果には取得時刻とfreshnessを表示する。
- 次タスク提案は候補数と評価理由を制限し、全repositoryの無制限走査を避ける。
- 初期実装Issueで、対象Issue数、応答時間、API call数の計測可能な目標を定める。

### 15.3 Resiliency

- claim、event、同期はidempotentにする。
- 部分失敗は完了扱いせず、reconciliation可能な中間状態として保持する。
- Dispatcher、Projects、集約処理が停止しても既存Issue作業を継続できる。
- stale情報に基づく割当を止め、read-onlyまたは手動Coordinatorへfallbackする。
- 再割当前にbranch、PR、未push変更、Issue内部stateの引き継ぎを確認する。

## 16. Project OrchestrationのGolden Test

Issue #8のGolden Testハーネスへ、次のfixtureを追加する。

- 1人・1feature・Issues-onlyで次Issueを提案する。
- 依存未完了のIssueを`available_for_work`にしない。
- DAGの循環と未知feature IDをblockする。
- 同一waveでも共有area競合を直列化する。
- inactive member、permission不足、capacity超過を割当候補から除外する。
- Organization Teamと`team.yaml`の不一致をblockする。
- 2つの同時claim要求を1つだけactiveにする。
- stale claimを自動stealしない。
- duplicate eventを冪等に処理する。
- GitHubとIssue内部stateの不整合をblockする。
- Dispatcher停止時に手動Coordinatorへfallbackする。
- AIが未割当Issueを勝手にclaimしない。
- bot更新で`on_behalf_of`が欠落した場合にblockする。
- Projects未採用のprojectでProjectsを要求しない。

静的fixtureを必須とし、AIによる優先度や意味評価は任意のinformational testへ分離する。

## 17. 後続実装Issueの分割案

| 順序 | 実装Issue | 主な成果物 | 依存関係 |
| :--- | :--- | :--- | :--- |
| 1 | Issue #8共通schemaとの連携 | `project_id`、`feature_id`、actor、eventの共通定義 | Issue #8の共通schema実装 |
| 2 | Project成果物schemaとtemplate | `project.yaml`、`delivery-plan.yaml`、`team.yaml` | 1 |
| 3 | feature依存DAGとwave validator | ID、循環、依存、共有area、計画revision検査 | 2 |
| 4 | member・ownership validator | membership、permission、capacity、integration owner検査 | 2 |
| 5 | 手動Coordinator運用 | status mapping、claim template、stale・release・再割当手順 | 3、4 |
| 6 | project集約とreconciliation | GitHub＋Issue内部eventのread-only集約、差分検出 | Issue #8状態チェッカー、3、5 |
| 7 | AI次タスクrecommender | 決定的な候補選択、理由、停止条件 | 6 |
| 8 | Project Golden TestとActions | 本文書の必須fixture、オフラインCI | Issue #8 Golden Test、3、4、5、6、7 |
| 9 | GitHub Projects adapter | opt-in field mappingと一方向同期 | 6、運用上の必要性 |
| 10 | 中央Dispatcher | 直列claim、idempotency、reconciliation | 5、6、8の運用実績 |
| 11 | 外部Agent Runner | event駆動実行、sandbox、権限、費用・停止制御 | 10の運用実績と別途High Risk承認 |

1から8までを初期の手動Coordinator対応範囲とし、9から11は利用規模と運用実績に基づくopt-inとする。Issue #8と重複するschema、event、Golden Test基盤は別実装を作らず、共通成果物へ拡張する。

## 18. 設計承認チェックリスト

- [x] AI主導の次タスク提案の入力、出力、停止条件、人間承認点が合意されている。
- [x] feature、Issue、stage、assignee、claim、branch、PRの追跡関係が合意されている。
- [x] DAG、循環検出、wave、共有area、再計画方式が合意されている。
- [x] GitHub、project成果物、Issue内部state、生成集約物の正本が合意されている。
- [x] `team.yaml`、Organization Team、permission、実効メンバーの関係が合意されている。
- [x] assignee、claim、Coordinator、integration owner、`CODEOWNERS`の責務が合意されている。
- [x] stale claim、担当離脱、部分失敗、重複event、不整合の復旧方法が合意されている。
- [x] Issues-onlyを初期標準、Projects・Dispatcher・Runnerをopt-inとする段階導入が合意されている。
- [x] Security、Privacy、NFR、Resiliencyの制約が合意されている。
- [x] Issue #8との連携と後続実装Issueの依存順序が合意されている。

本設計は2026-08-07に明示承認済みであり、後続実装Issueを作成できる。各後続Issueの作成、着手、実装承認は本承認に含めず、個別のIssue契約に従う。
