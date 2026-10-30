# 手動Coordinator運用

この手順は、GitHub Issuesを使って、人間が担当を割り当て、着手・中断・引き継ぎを記録するためのものです。
Coordinatorは割当と競合の調整担当、claimは誰がどの範囲に着手するかの記録、heartbeatは明示的な進捗確認、staleはその確認が古くなった状態です。
初期標準はIssues-only/manualです。1人・単一Issueの従来運用も継続できます。

[コメント様式](../../.ai-workflow/templates/project-manual/v1/README.md)をコピーして使い、最初に[合成の机上例](../examples/project-manual/walkthrough.md)を辿ってください。
[Project共通設計](project-orchestration-design.md)第4・7・9・10・13章と、既存のAGENTS.md/development-rules.mdのalways-onルールを維持します。

## 1. 導入時に決めること

1. 移行Issueとbranchを作り、導入元template commitと元の設定・記録を保存します。人間がProject採用範囲を承認します。
2. project/team/delivery-planの静的台帳、area、既定integration owner、人間のmember・role・権限、必要ならOrganization Teamを確認します。台帳変更はPRで承認します。
3. active Coordinatorをproject全体で1人、または重ならないareaごとに1人にします。同じIssue/共有areaへ複数人が同時に割当操作をしません。複数areaにまたがる操作は関係Coordinator全員が調整し、今回の操作担当1人を記録します。
4. project.yamlの`status_mapping`の8値について、mapping先labelが相互に異なり、他用途やready-for-aiと混同しないことを確認します。欠けるlabelは導入担当が作成するか導入を保留します。このテンプレートを読むだけではlabelを作成しません。
5. `claim_policy.heartbeat_interval_seconds`と`stale_after_seconds`を実案件で合意します。正整数という形式だけに頼らず、heartbeat間隔がstale閾値より短いことを確認します。例の4時間/24時間は推奨値やSLAではありません。
6. GitHub Issue/PRを担当・claim・project statusの正本とします。実状態を静的YAML、Issue内部state、手編集の共有Project stateへ複製しません。全量claim inventoryやchecker contextは確認時点の一時snapshotです。

新CLI/API、自動割当、コメントparser、排他ロック、集約・推薦、Projects/Dispatcher/Runnerはこの手順には含まれません。
GitHubのコメント・assignee・label・branchの更新は別々の操作です。手動直列化は原子的な排他や自動冪等性を保証しません。

## 2. project statusの使い方

採用したIssueにはproject status用labelを原則1つ付けます。他用途のlabelは共存できます。
操作担当は変更理由と変更前後をコメントへ残し、対応するlabelを変更して読み戻します。途中で0件/複数/未知のstatus labelを観測したら、新規割当や着手を止めて照合します。
自動修正せず、最新の根拠記録と実状から人間が1つへ整えます。

| 機械可読status | 使う条件 | 次の判断・復帰条件 |
| :--- | :--- | :--- |
| draft | 契約または依存が未確定 | 契約・依存・必要承認の準備を確認してavailable_for_workへ。着手はしない |
| available_for_work | 契約・ready-for-ai・依存・必要承認の準備が揃い、割当可能と人間が確認 | 人間ownerを確定しassignedへ。未成立ならdraft/blockedへ |
| assigned | 責任を持つ人間ownerが確定し、active claimはまだない | 最新条件を再確認しclaim/branchを確定してin_progressへ |
| in_progress | 有効なactive claimと作業branchがあり作業中 | 実stageに沿って継続。レビュー待ちはin_review、阻害要因があればblockedへ |
| in_review | 設計承認またはPR等のレビュー待ち | review対象・current stage・claim有無を明記。承認後も必要条件を確認して該当stageへ戻る |
| blocked | 依存・承認・競合・権限・障害等で進められない | 理由と停止範囲を記録。解消後に再確認し、claimありならin_progress/in_review、claimなしで割当ありならassigned、未割当ならdraft/available_for_work等の実状へ戻す |
| completed | 契約と必須検証の完了を人間が確認した終端 | claimの終了・未push/残作業を別に確認。再開には明示再オープン・再契約・新claimが必要 |
| cancelled | 人間が終了を決めた終端 | 理由・残作業・下流依存の扱いとclaim終了を記録。再開には明示再オープン・再契約・新claimが必要 |

基本経路はdraft→available_for_work→assigned→in_progress→in_review→completedです。実際の条件に応じblocked/cancelledへ移ります。
設計レビュー待ちはclaimなしのin_reviewでも構いません。実装承認待ちでも、承認された設計作業のclaimを保持している場合はそのclaimを明記します。
claimがまだない設計レビューは通常のIssueコメントにreview対象・current stage・claimなし・理由を記録します。存在しないclaim_idを作ってclaim-update様式へ埋めません。
設計承認待ちのin_reviewから実装へ直行せず、当該Issueの工程承認とclaim/branchを確認します。完了後に別claimを始める際は前のclaimを先に終了します。

ready-for-aiはAIへ依頼できる契約の準備を示し、自動着手・担当確定・排他を意味しません。
assigneeは人間の責任、claimは着手、current_stageはIssue内部の工程です。pauseは更新の目的であり第9のproject statusではありません。
GitHubのopen/closedとproject statusも別です。Issue close、PRのclose/mergeだけで契約・検証の完了を推測しません。

## 3. 割当から着手まで

### 直前に確認すること

- 実Issueの目的/AC/スコープ/非スコープ、ready-for-ai、変更リスクと該当Quality Gates、必要な人間承認。
- 対象featureの依存・計画改訂、必要制約の成立と確認時刻。計画validatorのwave/候補は着手命令ではありません。
- 人間owner1人の引受、実assignee、AIへの依頼。botのcredential loginを人間ownerにしません。代理ならon_behalf_ofと確認できる依頼根拠を残します。
- 現在のactive membership、role、全担当area、repository permission、設定されている場合のTeam。共有areaのintegration ownerと関係Coordinatorの合意。
- 全量active claimと同時担当上限、既存PR/branch/着手コメント/他agent・未push作業、変更pathの重複。存在しないことと、確認不能であることを分けます。

対象を絞って確認しても、capacityにはproject全体の全量active claim確認が必要です。部分的な一覧だけで空きがあると判断しません。
既存[計画・member検査](operations-manual.md)を使う場合は、対象台帳revision/digest、観測・評価時刻、元入力と結果の参照を記録し、not_evaluatedも確認します。
古い結果JSONを許可の根拠に使わず、最新事実から元入力を再検査します。unknown・古い確認・partial inventoryや実確認不能なら停止します。
memberのeligible/passは提出記録の整合判定です。実権限・本人性・承認・実scope競合の確認や人間の担当確定を代替しません。
candidateは新規担当条件、assigned_ownerは割当済みownerの確認です。既存本人claimの再開はcandidateで再取得しません。

### 人間が操作を確定する順序

1. Coordinatorが直前条件を確認し、[assignment](../../.ai-workflow/templates/project-manual/v1/assignment.md)へowner、協力者、scope/非担当、primary agent、areaごとのintegration owner、根拠と引受を記入します。Issue限定owner上書きは該当areaのCoordinator承認を参照します。
2. 人間がassigneeを設定・読み戻し、assignment確定を追記し、statusをassignedへ変更・確認します。追加assigneeがいてもhuman_ownerは1人です。未割当や他人担当を各AIが自由取得しません。
3. 今回の着手操作担当を1人にし、[claim](../../.ai-workflow/templates/project-manual/v1/claim.md)の準備記録を残します。一意claim_id/operation_id、予定branch、base commit、scopeを記入します。未作成branchは「作成予定」、claimed_atは「未確定」として、準備中をactive claimと誤認しません。
4. 確定したscopeへの依頼に基づきIssue branchを作成し、実在・base commitを確認します。作成済みなら所有・既存作業を確認し、勝手に再作成/削除しません。準備操作中も同Issue/共有areaの別割当を止めます。
5. Issue/assignee/claim/PR/branch/競合/承認/capacityを再確認し、人間Coordinatorまたは割当済み人間ownerの明示依頼を根拠に、同claim_id/operation_idで別record_idの確定記録を追記します。claimed_atと最終明示heartbeat、project方針参照を残します。
6. 実claimコメント、assignee、branchが一致することを読み戻し、statusをin_progressへ変更・確認します。全操作一致後に開始確認を追記して、承認済みの次stageだけを進めます。失敗や応答不明なら新作業を止め[照合](#6-部分失敗と不整合の復旧)へ戻します。

確定したclaimがあってもstatus更新失敗などの操作全体が未解消なら、新規作業は保留です。claimの枠は保持します。
準備中のclaimは確定inventoryへ混ぜませんが、その予約・不確定操作を理由に対象Issue/areaの割当を止めます。確認できないinventoryをcompleteと申告しません。
同時要求が来たら同Issue/共有areaの操作を並行せず、Coordinatorが前操作の完了/取消を確認してから次を判断します。

## 4. 更新・stale・再開と同時担当数

[claim-update](../../.ai-workflow/templates/project-manual/v1/claim-update.md)を使い、既存claim_idと直前recordを参照して追記します。
heartbeat/pause/block/resume/reviewの目的、実current stageとstate/checkpoint、branch/HEAD/PR、検証、blocker、次の作業を残します。
reviewは対象（設計承認またはPR）とclaim有無を明示します。必要な承認を受けずstageを飛ばしません。

staleは「評価する実UTC時刻 − 最後に明示確認したlast_heartbeat_at > stale_after_seconds」で警告します。
等しい時点は境界、超過で警告です。初回は確定claimの明示heartbeatを使います。未来時刻・policy不明・時計の不整合では正常とみなさず人間が照合します。
無関係なコメントやPR更新でheartbeatを補いません。単なる記録の転載でも確認時刻を現在へ更新しません。
警告後は人間がowner/branch/PR/直近の作業記録を確認し、明示heartbeatで継続、pause/blockedで保持、停止/引継確認後にrelease、または不明のまま再割当停止のいずれかを記録します。
自動stealしません。休日・勤務事情などを記録する必要はありません。

| 状況 | capacityと着手の扱い |
| :--- | :--- |
| 新規claim | 現active Issue数+1がmax_concurrent_issues以下であることを確認 |
| 本人の既存claimをassigned_ownerとして確認・再開 | 追加0。同じclaimを維持し新規枠を消費しない |
| 対象に別人claim/別owner | 停止。上限に空きがあっても取得しない |
| paused/blocked/in_review/inactive/stale | 解除確定まではactive inventoryに残す |
| 解除依頼、未確定/部分失敗 | 空きとみなさない。既存枠・不確定操作を保守的に保持して照合 |
| 解除確定と停止/引継の確認済み | inventoryから除外できる。labelだけで除外しない |
| Coordinator/integration owner/reviewerという役割だけ | active claimがなければ枠を加算しない |

重複claim/Issue/work IDや競合する記録を黙って捨てて件数を合わせません。不正な一覧はそのままcheckerへcompleteとして渡さず、人間が根拠を照合します。
再開は同人間owner/claim/branch/commitを照合し、未push差分・stateの安全な再開地点、必要承認/依存/権限/競合を再確認します。
assigneeだけが変わっていれば同claimのownerを書き換えず停止します。scope拡大も先に契約・承認を確認し、既存claimの変更履歴を追記します。

## 5. 解除・再割当・Coordinator交代

### claimを解除する

1. [claim-release](../../.ai-workflow/templates/project-manual/v1/claim-release.md)で解除依頼を追記します。理由が完了・取消・担当変更のどれかを明記し、依頼だけでactive枠を空けません。
2. Coordinatorが旧owner/agentの更新停止、最終branch/HEAD/PR、未push変更の有無と保存先、内部state/checkpoint、残課題を確認します。未push変更不明なら解除・再割当を保留します。本人が不在でも情報が不明なまま引継済みにしません。
3. 担当変更なら引継先人間の受領を確認します。不要な場合も理由を明記します。秘密や生diffをコメントへ転載せず必要な参照だけを残します。
4. 人間Coordinatorの明示判断を根拠に、同operation_id/旧claim_idで別record_idの解除確定を追記します。released_at、停止/引継根拠、inventoryから除外した確認を記録します。
5. 完了なら契約・必須検証・人間レビューを別途確認してcompleted、取消なら人間の取消判断・残作業/下流への影響を記録してcancelledへ。解除だけでcompletedにしません。status更新失敗時は新規割当を保留し照合します。

再割当は旧解除確定・停止/受領の実在を読み戻してから、owner/assignee/引受を改めて確認し、新claim_idで開始します。
旧claimはrelease/supersededの追記で終了し、旧コメントを書き換えません。新claimは旧解除recordを参照し、新claim確定後の関連付けも別コメントに追記します。
解除前の同owner再開は同claim、解除後の再着手は同ownerでも新claimです。終端からの再開は明示再オープンと再契約を経ます。

### Coordinatorを交代する

[coordinator-handoff](../../.ai-workflow/templates/project-manual/v1/coordinator-handoff.md)を交代管理Issueへ記録し、影響Issueからも参照できるようにします。
旧担当が割当更新を止めた時刻、対象area、全active claim、未完了操作IDと成否・不明点、branch/PR/state/未push作業の参照を引き継ぎます。
新担当の受領と実member/権限・担当area、project/teamの設定変更PR承認と反映commit、旧担当停止を確認して切替時刻を追記します。
新担当は切替確定前に割当更新を開始しません。切替間は新規割当を保留し、確認済み既存claimの作業だけを継続できます。
旧担当が停止したか確認できなければ、新担当が同じ範囲で操作せず人間へ照会します。既存claimのhuman_ownerは暗黙変更しません。

## 6. 部分失敗と不整合の復旧

[reconciliation](../../.ai-workflow/templates/project-manual/v1/reconciliation.md)は「期待と実状を人間が照合する記録」です。集約器や自動修復処理ではありません。
不整合を見つける補助として、[運用マニュアル](operations-manual.md)のProject集約libraryへ確認snapshotとIssue内部の元入力を渡せます。Markdown様式は自動解析せず、人間が記録を確認して投影します。検出結果でlabel/claimを修正せず、この手順へ戻って判断します。
元operation_id、全関連record、期待した更新と観測時刻・実状態、成功/失敗/不明、停止範囲、枠の扱いを分けて追記します。
応答不明は未実行とは限りません。再送前に同じrecord/operationの実コメントとassignee/全status label/claim/branch/PRを読み戻します。
人間が不足操作のみの補完・継続・取消・保留を決め、別record_idで判断と最終読み戻しを記録します。
未解消の対象Issue/共有areaでは新規割当・着手を止め、確認済みで無関係な既存claimまで一律に解除しません。

| 状況 | 人間の確認と復旧 |
| :--- | :--- |
| 同record_id・同内容の再投稿 | 同じ記録として既存記録を参照。二重claim/枠消費をしない。自動dedup済みとは扱わない |
| 同record_idの異内容、同試行の競合、二重claim | 全記録を残し停止。owner/時刻/作業/承認を照合し人間が有効記録と終了を決める。同operation_idでも別record_idで前記録を参照する準備→確定などの追記は正当な更新 |
| branch成功・claim応答不明・label失敗 | 全体未確定。新claim_idで再試行せず、既存投稿/branchの実在を確認して不足操作を判断。確定claimがあれば枠を保持 |
| branchだけありclaimなし | 所有・準備操作・未push作業を確認。無断削除/再作成/取得をしない |
| claimありbranchなし | 未開始/削除/別branch等を確認し停止。勝手にbranchを再作成しない |
| status labelが0/複数/未知 | 根拠コメントと実状から人間がmapping先1つへ修正。labelだけでclaimを変更しない |
| assignee変更、GitHubと内部stageの不一致 | 更新時刻と契約/承認/claim/stateを比較。自動owner変更や完了上書きをしない |
| dependency失敗/取消 | 下流を止め、人間が代替依存/再計画を承認。完了扱いで進めない |
| 権限/API/通信/最新性の確認不能 | 新規割当を保留。人間の確認参照でも事実を確定できなければunknownのまま停止 |
| 取消やclose後もclaim終了不明 | 終端label/closeから枠を解放しない。旧作業を調べ専用解除確定を残す |

## 7. 導入・fallbackと確認範囲

最初は移行branchで机上例を辿り、コメントと手順の整合をレビューしてから人間が採用します。
公開元repositoryに利用先の実Project設定や共有stateを作らず、実label/権限変更・自動claimを暗黙に有効化しません。
復旧不能なら元台帳と全記録を保存し、新規割当を保留して従来のIssue/assignee/着手コメント/branch/PR運用へ戻す判断を記録します。
fallbackで未解消claimをなかったことにせず、所有・scope・未push/引継を照合してから個別に再開/解除します。
Projectを採用しない単一Issue運用にはこのlabelや様式を要求しません。

Quality Gatesの確認範囲は次のとおりです。

- NFR: 新runtime/走査/API取得なし。人間の操作時間、大規模運用性能やSLAは未計測。
- Security: 人間owner/依頼/権限/scope/承認の確認、最小記録、秘密非保存を手順化。actorや参照の記入だけで本人性を認証しない。追加token/API権限なし。
- Resiliency: 重複/部分失敗、stale、停止/引継、Coordinator交代とfallbackの机上確認。原子的claim・自動冪等処理・実API障害復旧の保証なし。

机上例の確認と既存テストの成功は、実案件の同時操作・本人引受・未push作業・GitHub障害復旧を実証しません。
明示snapshotのread-only集約/差分検出は追加利用できます。実GitHubの自動取得、保存Project自動走査、次Issue推薦、Project全体Goldenは後続Issueです。
