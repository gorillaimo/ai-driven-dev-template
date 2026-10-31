# Migration Guide: v1 to v2

このドキュメントは、v1の文書・prompt中心のIssueベース運用から、v2のadaptive workflowとproject orchestrationへ段階移行する方針を定義する。

## 1. 現在の注意事項

- v1 stable: `v1.0.0`
- v2: development line
- `v2.0.0`stable Release: 未公開
- 現在の`main`にはIssue成果物のschema v1、YAMLテンプレート、同梱例の形式テスト、モジュール式ルール解決libraryがある。計画・状態・再開候補の静的checkerも利用できる。追跡性checkerとBrownfield手順・深度別テンプレートも利用できる。Golden TestとIssue内部のActions統合も利用できる。Projectの3成果物schema・合成記入例・形式テストも利用できる。Projectの依存DAG・wave・計画改訂validatorも利用できる。member/ownership/capacityのsnapshot検査も利用できる。手動Coordinatorの手順・コメント様式・机上例も利用できる。明示snapshotの進捗集約・不整合検出も利用できる。実GitHubの自動取得・推薦は後続実装。工程は自動実行しない

設計文書が存在するだけで、AIが状態管理、自動再開、次Issue選択、claim、複数人調整を自動実行できるとは扱わない。対応する後続実装Issueが完了した機構だけを有効化する。

## 2. 移行しない選択

v1運用が要件を満たす場合、移行は必須ではない。

- `v1.0.0`tagを基準としてrepositoryを作成する。
- Issue、assignee、`ready-for-ai`、着手コメント、branch、PR、人間承認を継続する。
- `main`のv2開発中の変更を自動で取り込まない。
- v1 patchが必要な場合は、Issueを作成してv1保守方針を確認する。

## 3. 移行前の確認

### 3.1 Template由来の差分

- 利用開始時のtemplate tagまたはcommit。
- `AGENTS.md`、共通規約、Issue Form、PR template、Actionsへの独自変更。
- `docs/system-context.md`、`docs/architecture.md`、API、認証、Infrastructureへのproject固有変更。
- AIツール固有の入口、権限、commands、skills。

### 3.2 Brownfield確認

既存projectへ導入する場合は、機能実装と混ぜず調査Issueを作成する。ディレクトリ、技術stack、テスト、CI/CD、API、Auth、Data、Infrastructure、secretの所在、変更禁止領域、後続Issue候補を整理する。値やsecretは成果物へ記録しない。

### 3.3 Backupとfallback

- 移行前commitまたはtagを記録する。
- 移行を独立branch / PRで行う。
- 従来のIssueベース運用を削除しない。
- schemaやcheckerが失敗した場合に手動運用へ戻れることを確認する。
- 自動割当、merge、deployを移行と同時に有効化しない。

## 4. 段階移行

### Phase 0: v1契約を固定する

- 対応Issue、assignee、`ready-for-ai`、承認、Quality Gatesを最新化する。
- 既存の着手コメント、branch、PR、未完了作業を整理する。
- v2導入の目的、対象範囲、非スコープ、成功条件を移行Issueへ記載する。

この段階では動作を変更しない。

### Phase 1: v2設計を参照する

- `docs/common/adaptive-workflow-design.md`を確認する。
- 複数feature / Issueを扱う場合は`docs/common/project-orchestration-design.md`を確認する。
- Issue内部とproject全体の正本・責務境界を合意する。
- 利用しない機構を明記する。

設計だけを導入した状態では、v1と同じ手動運用を継続する。

### Phase 2: Issue内部schemaを導入する

後続実装が利用可能になった機構だけを導入する。

- plan、state、traceability、Brownfield成果物のschemaとtemplate。
- `project_id`、`feature_id`、`actor_ref`、`on_behalf_of`、標準event。
- schema validationと参照整合check。

Issue成果物にはschema v1、テンプレート、同梱例の形式テストがあり、状態・履歴・再開候補は静的checkerで検査できる。宣言されたACの対応経路と対応するローカル参照は追跡性checkerで検査できる。外部到達性・自然言語・テスト成功の実証は人間の確認が必要。`operations-manual.md`の「Issue成果物テンプレートの利用」に従い、形式と実際のIssue記録を分けて確認する。

最初のv2成果物schemaが`schema_version: 1`でも、template v2と矛盾しない。

### Phase 3: CheckerとGolden Testを導入する

- 適応的計画と状態遷移checker。
- フェーズ境界の追跡性checker。
- Brownfield、Low / Medium / High RiskのGolden Test。
- PRのoffline GitHub Actions。

最初はwarnまたは任意checkとして計測し、誤検知、実行時間、成果物量を確認してから必須化する。

### Phase 4: Project orchestrationを導入する

複数feature / Issue / 開発者を追跡する必要がある場合だけ導入する。

- `project.yaml`、`delivery-plan.yaml`、`team.yaml`。
- feature ID、依存DAG、wave、共有area、integration owner。
- GitHub Issuesをruntime backendとする手動Coordinator運用。
- assignee、claim、stale / release / 再割当、read-only集約。
- AIによる次タスク提案。未割当Issueの自動claimは行わない。

1人・単一Issueのprojectでは、project orchestrationを省略してもよい。

### Phase 5: 任意自動化

GitHub Projects、中央Dispatcher、外部Agent Runnerは、手動運用とGolden Testの実績を確認した後、個別のHigh Risk Issueと人間承認で導入する。

v2.0.0への移行条件として必須にしない。

## 5. Compatibility matrix

| 項目 | v1 | v2 development / stable target |
| :--- | :--- | :--- |
| Issue契約 | 必須 | 必須。廃止しない |
| 人間assignee | 必須 | 必須。AIをassigneeにしない |
| 人間承認 | 必須 | 必須。機械的Gateを追加 |
| prompt選択 | 人間が工程ごとに選択 | AIが計画と次作業を提案 |
| Issue内部state | 会話・コメント中心 | Issue別YAML＋GitHub参照 |
| 再開 | 人間がcontextを再提示 | stateとGit差分から安全に再開 |
| 追跡性 | 人間review中心 | 静的checker＋人間review |
| feature依存 | system contextと人間判断 | DAG、wave、共有areaで検査 |
| team / claim | assigneeと着手コメント | team schema＋手動Coordinatorから開始 |
| Golden Test | なし | offline fixtureを必須化 |
| Projects / Dispatcher / Runner | なし | 任意。stable v2.0の必須条件ではない |

## 6. Fallback

次の場合は新しい自動化を停止し、v1互換の手動運用へ戻す。

- schema破損またはversion非対応。
- GitHubとIssue内部stateの不整合を解消できない。
- checkerの誤検知で安全な作業を継続できない。
- GitHub API、Projects、Dispatcher、Runnerが利用不能。
- membership、permission、assignee、claimを確認できない。
- secret、個人情報、費用、外部送信の懸念がある。

Fallback時も、Issue契約、assignee、branch、PR、承認、検証結果を維持する。新しい成果物を削除して履歴を失わせず、無効化理由と最後に正常だった境界を記録する。

## 7. 移行完了条件

- 採用したv2機構と省略した機構が明記されている。
- 既存project固有ルールを失っていない。
- schema、参照、checker、Golden Testが対象範囲で成功する。
- GitHubとIssue内部stateの正本が矛盾しない。
- Security、Privacy、NFR、Resiliencyの該当事項を確認した。
- 人間が移行結果とfallback手順を承認した。
- 未導入の自動化を利用可能であるかのように説明していない。

## 8. 参照

- `docs/common/versioning-policy.md`
- `docs/common/adaptive-workflow-design.md`
- `docs/common/project-orchestration-design.md`
- `docs/common/development-rules.md`
- `docs/common/operations-manual.md`
- [v1.0.0 Release](https://github.com/gorillaimo/ai-driven-dev-template/releases/tag/v1.0.0)

## モジュール式ルールへの追加移行

既存AGENTS.mdとdevelopment-rules.mdは移動せず、legacy always-onの参照metadataを追加します。
ルールを一括分割する必要はありません。rule schema v1とrule version 1.0.0はtemplate v2とは別管理です。
旧planのlegacy version文字列`1`は形式上そのまま保持できます。新resolverで明示再解決した結果から
固定SemVerとmetadata参照へ置換し、plan revisionを更新して差分をレビューします。
plan schema v1を改変せず、詳細結果をextensions.rule_resolutionへ保存します。
任意のextensionsを保存しただけでは検証済みにならないため、必ずprojectPlan経由で再解決・検証します。
元成果物とtemplate commitを保存し、metadata/本文/context/opt-in変更時は再読込・再解決します。
非対応version、未知条件、循環、競合が解消できない場合は自動進行を止め、元データを保持して従来のIssue運用へ戻します。

## plan/stateの意味検査への追加移行

既存schema v1の成果物はそのまま形式検証できます。新checkerの通過には、人間が確認したcontext、
再解決済みrule結果、state.extensions.workflow_checkの承認・検証・改訂scopeを明示的に追加します。
初期plannedの空履歴以外は履歴と現在地を照合し、追記性確認にはpreviousを保存して比較します。
複数改訂の履歴がある場合は過去のrevisionPlansも用意します。過去計画や承認が失われていれば推測で補わず停止します。
日時・actor・履歴を都合よく作り直してcheckerを通過させません。元の成果物・template commitを保存して
Issue上の事実と人間が比較し、復元できない承認は再承認を受けます。
unknown/nullは不要/falseではありません。候補を出せない場合も従来のIssue・branch・PR運用へ戻れます。

## 追跡性checkerへの追加移行

旧traceability schema v1は形式を変更しません。新しい意味検査にはIssueから確認したAC/非スコープ台帳と
change_inventory、workflowInput、必要な外部参照の人間確認を追加し、型付きリンクの方向を第7章へ合わせます。
既存checksのpassや補助referencesだけで工程通過済みにしません。元成果物とtemplate commitを保存して明示移行します。
Markdownの自動見出しanchorなど初期未対応の参照は、明示anchorやJSON Pointerへ変更するか、未評価として人間へ戻します。
既存抑制にも対象・改訂・境界・subject_digestのscopeが必要です。古い抑制を新しい入力へ自動移送しません。
移行できない場合は元データを保持し、従来のIssue・branch・PRと人間レビューで開発を継続できます。

## Brownfield深度別テンプレートの追加利用

既存brownfield schema v1と旧最小例は引き続き利用できます。新規例への置換は強制しません。
読み取り専用調査が必要な場合、brownfield-analysis-guide.mdに従い深度・scope・除外・上限を人間が合意し、
必要なMD/YAMLを選んで実際のID・基準commit・参照へ明示置換します。
Highの例は承認待ちであり、コピーしただけで調査開始は許可されません。
元成果物を保存し、未確認や承認履歴を人間が比較してから利用を切り替えます。
extensionsのメモや形式テストの成功だけで調査完了・安全性・実装許可を推測しません。
移行できない場合も元データを保持し、従来の調査専用Issueと人間レビューを継続できます。

## Golden Testの追加導入

既存成果物schema v1、AGENTS.md、development-rules.md、checkerの判定規則は変更しません。
新ハーネスは追加導入で、利用先アプリケーションの言語や実行基盤を変更する必要はありません。
運用マニュアルの手順で既存checkerとGolden Testの依存を導入し、固定合成fixtureをオフラインで検査します。
fixtureの`format_version: 1`は実作業の`schema_version`、template release versionとは別管理です。

期待見本や禁止条件を移すときは、元のtemplate commitとfixtureを保存し、新しい判定の理由をIssue・PRでレビューします。
不明なversion、壊れた入力、予期しない差分は失敗です。実結果で見本を自動上書きせず、失敗したcase IDと比較pathから原因を確認します。
合成の承認・検証履歴を実作業へコピーしません。移行できない場合も元データを保持し、個別checkerと従来のIssue・branch・PR運用を継続できます。
Golden Test単体ではActionsを起動しません。Actions接続は以下の追加導入で有効にします。v2 stable公開は別の承認事項です。

## Issue内部ワークフローのActions追加導入

新workflow-validation.yml、workflow-ci packageと対応tests、既存5tool package/tests、schemaを揃え、既存2workflowを残して追加します。
既存schema/checker/規約/VERSIONとアプリ構成は変更しません。新reportのformat_version:1は既存成果物のschema_versionと別管理です。
YAML保存を採用していなければ成果物検査は対象0件となり、従来運用を継続できます。
保存済み成果物はschema/識別子と必要参照を人間が見直し、未来成果物や外部URLが未評価になることを確認します。
CIのmerge commitと古い作業用Git snapshotを同一とみなさず、実作業の承認・履歴・再開の意味検査は既存checkerで個別に行います。
参照欠落等で移行できない場合は元データを保持し、診断のcode/path/locationから人間が原因を確認します。
無効化する場合は新workflowだけを止め、個別検査とIssue/branch/PRの手動運用へ戻れます。
required check設定を既に追加している場合は人間が設定を先に見直します。今回その設定は変更しません。
新workflowのmergeはAI意味評価やv2 stable公開の承認を意味しません。

## Project schema v1の追加導入

既存Issue成果物を変更せず、必要な場合だけProject設定・delivery plan・team台帳を追加します。
`.ai-workflow/templates/project/v1/`の合成例とREADME、`.ai-workflow/schemas/project/v1/`、既存Issue共通schemaをまとめて参照します。
元ファイルとtemplate commitを保存し、project_id・template_origin・人間login・area・feature source・Issue・方針値を実案件へ明示置換します。
初期対応はIssues-only/manualで、Project採用の強制や実行時状態の一括移送は行いません。

`npm run test:project --prefix tools/workflow-schema`は同梱例の形式テストです。保存Projectファイルの意味検査や権限確認を実施する移行ツールではありません。
形式に適合する自己依存や重複IDもあり得るため、人間が依存・一意性・member・area・capacity・承認を確認します。依存DAG・wave・改訂は後掲のvalidatorで追加検査できます。member/ownership/capacityは後掲のsnapshot検査で追加確認できます。
GitHubの実status/assignee/claimを静的台帳へ複製せず、共有Project state.yamlを作りません。
修復できないときは元台帳を保存し、従来のIssue/assignee/着手コメント/branch/PR運用へ戻れます。
新schemaの追加はalpha/stable Releaseや、Projects/Dispatcher/Runnerの有効化を意味しません。

## Projectの依存・wave・改訂validatorの追加導入

既存Project/Issue schemaを保持し、`tools/workflow-project/`と対応tests、`.ai-workflow/schemas/project-plan-checks/v1/`を追加します。
既存workflow-rulesの安全loader・canonical/digestを再利用します。新packageのlockfileに従って依存を導入し、CIへは固定install/testコマンドだけを追加します。
同梱のcontextは合成例です。実作業の状態や承認としてコピーせず、対象台帳のrevision/digestと、人間が確認した状態・条件・evidenceを一時snapshotへ記録します。
初期revisionは1/history空。改訂は理由・approval・影響ID・旧waveを追記し、直前snapshotを保持します。既存履歴が不明なら初回承認や過去改訂を捏造しません。
形式適合する循環・重複ID・古い確認記録等が意味検査でblockされる場合、人間が元データと差分を照合します。unknown条件を推測でsatisfiedへ変更しません。
waveとdependency_candidatesは担当・claim・着手権を確定せず、進行中作業を自動移動しません。member/ownership/実権限/capacity/実在/本人性/全過去原本は別途確認します。
導入手順と実行例は運用マニュアルの「機能の依存関係と開発順序を検査する」、計算規則と上限はproject-orchestration-design第8.4節を参照してください。
保存Project自動走査、Project Golden、自動割当・集約は後続対応です。修復不能なら元台帳を保持し、個別Issueと手動Coordinatorへ戻せます。Releaseは別の承認事項です。

## member・ownership・capacity検査の追加導入

既存Project/Issue schemaと計画checkerを保持し、project packageのmember用modules/exports/test:members、対応tests、project-member-checks/v1のcontext/resultを追加します。
新しい依存やlockfile更新は不要です。CIへは固定のtest:membersコマンドだけを追加します。
元台帳/導入commitを保存し、人間がloginの重複・area・管理担当・既定統合責任者の双方向宣言を照合します。未解決の所有や権限を推測で補完しません。
contextの合成例は実際の権限・本人性・claimの証拠にせず、実案件の確認記録へ置換します。revision/digestと明示観測/評価時刻、証拠参照、active claim全量の確認が必要です。
Issue単位のowner上書きはrequest.owner_overridesのIssue/work/areaとCoordinator approvalに限定し、静的なteamの既定所有を変更しません。
新検査でblockされても、古いresultの流用・不明な承認の作成・stale claimの自動解放は行いません。元入力を保持して人間が確認し、再実行します。
eligibleは提出された条件適合だけで、担当変更・claim開始・実認証を意味しません。従来のIssue/assignee/着手コメント/branch/PRと手動Coordinatorへfallbackできます。
実行例と結果は運用マニュアル、計算規則・上限・未評価はproject-orchestration-design第9.4節を参照してください。Release、Project全体Golden、実API collectorは別途対応です。

## 手動Coordinator様式の追加導入

移行Issue/branchで元台帳・template commit・既存claim/PR/未push作業を保存し、人間が導入範囲を承認します。
[手順](manual-coordinator.md)、[様式](../../.ai-workflow/templates/project-manual/v1/README.md)、[机上例](../examples/project-manual/walkthrough.md)を参照し、active Coordinator、status_mappingの8label、heartbeat/stale値を確認してください。
様式をGitHub Issueへ明示コピーし、実番号/人間login/根拠/時刻/branchへ置換します。公開元や利用先でlabelを自動作成する仕組みはありません。
既存着手記録を新しいclaimとして二重登録せず、所有・変更scope・作業と元記録を照合して関連参照を追記します。既存schemaや結果を暗黙変換しません。
コメント様式v1はschema_versionとは別です。既存Project/Issue schema、checker、CI、always-on規約、VERSIONを変更しません。
確認不能や部分失敗では新規割当を保留し、元記録を残して従来のIssue/assignee/着手コメント/branch/PRへ人間判断で戻します。未解消claimは消さず個別に照合します。
机上確認は実案件の排他・GitHub障害の試験ではありません。自動集約・推薦・Project全体Golden、alpha/stable公開は別途対応です。

## Project進捗集約の追加導入

必要な場合だけ、既存rules/check/projectのpackageとschema一式、projectのaggregate用modules、project-aggregate/v1、合成例を追加参照します。既存依存/lockfile・schema・規約・VERSIONは変更しません。
人間がGitHub記録とIssue元成果物を取得・確認し、対象ID/revision/digest・観測時刻・全量取得範囲を明示したsnapshotへ投影します。取得そのものやMarkdown様式の解析は行いません。
managed/legacyを明示し、未採用の内部工程を無理に補完しません。チェック結果だけで担当・claim・承認・完了を確定せず、人間が実状を確認します。
checkpointは元データとともに保持し、取得不能や入力不整合で既確認Issueを削除しません。計画revision/digest変更時は人間が元履歴を保持し、checkpointなしで全量再集約する判断を明示します。
実際の入力方法、出力の未評価範囲・上限・停止/復旧は[運用マニュアル](operations-manual.md)を参照してください。復旧不能なら手動Coordinator/従来Issue運用へ戻します。
実GitHubの自動取得・自動修復/解放・推薦/Project全体Golden・Releaseは別途対応です。

## 次作業推薦の追加導入

必要な場合だけ、既存rules/check/projectの依存とschema一式に、projectのrecommend用modulesとproject-recommend/v1、合成例を追加参照します。既存規約・schema・依存lock・VERSIONを変更せず、単一Issue運用も継続できます。
人間/既存接続ツールで元記録・人間/AIへの依頼・権限・全量claim・契約/承認/範囲を確認し、推薦contextと集約元入力を明示します。代理実行は人間ownerと根拠、既存claimは今回のagentと引継ぎを照合します。
元入力を再検査し、待機/不明/不整合では別Issueを取得しません。未割当はCoordinator相談まで、legacyの既存工程は手動確認です。結果で担当/claim/stage/履歴を自動更新しません。
利用手順・停止理由・上限・未評価範囲は[運用マニュアル](operations-manual.md)を参照し、復旧不能なら元記録を保ち手動Coordinatorへ戻します。保存Project走査・Project全体Golden・実GitHub取得/操作・Releaseは別途対応です。

## Project Golden Testの追加導入

同じtemplate commitのGolden tool/tests/fixture一式を保持し、既存workflow-projectの依存も導入します。既存12caseと追加25caseを同じ命令で検証し、必要caseを省略したsuiteは失敗します。利用先Projectの設定や実状態をコピーする必要はありません。
既存format_version:1の比較/禁止/normalize規則は保持しますが、4つの新adapterと未選択時のreport行が追加されます。既存成果物schema/checker/規約/VERSION・依存lockの移行は不要です。
導入方法・手動見本更新・第16章対応は[運用マニュアル](operations-manual.md)と[固定例](../examples/project-golden/README.md)を参照してください。失敗時に元データを修復せず、保存した旧一式・個別checker・手動Coordinatorへ戻ります。
実GitHub操作、原子的claim、実Dispatcher停止/復旧、AI意味評価、保存Project走査は対象外です。CI成功からalpha/stable Releaseを作成しません。
