# 手動Coordinator運用の机上検証

手順・様式を作成する前に定義した入力と期待動作です。実GitHubの操作、本人確認、同時実行、API障害試験は行いません。
人間が[運用手順](../../common/manual-coordinator.md)と[コメント様式](../../../.ai-workflow/templates/project-manual/v1/README.md)を読み、各ケースの停止点と残す記録を辿ります。自動Golden Testの追加ではありません。

## 合成の前提

- repository: `example/project`、project_id: `example-app`、feature_id: `profile`。
- 対象: `https://github.com/example/project/issues/42`、work_id: `issue-42`。実在のIssueや権限を示しません。
- Coordinatorは`coord`、人間ownerは`alice`、共有area `contracts`のintegration ownerは`owner`。代理記録者は`ai_agent / codex-session-example`、on_behalf_ofは`alice`。
- project/team/delivery-planは承認済みrevision 1、担当areaは`backend`、変更scopeは`packages/backend/profile/`、非担当は`docs/api/`と他feature。共有areaを扱うケースだけ`contracts`を追加します。
- aliceはactiveなhuman/developerでbackendを担当でき、必要repository permissionと任意Teamを確認済み。max_concurrent_issuesは1。
- 作業開始直前の全量active claim inventoryは0件。依存と必要承認は確認済み、Issue契約とready-for-aiが揃い、他PR/branch/未push変更との競合はありません。
- project statusの8つのmapping先labelはそれぞれ異なり、事前に導入担当が用意済み。合成のheartbeatは4時間、staleは24時間。UTCを使います。
- 記録の`evidence_refs`は以下の`example-record-*`見出しへの文書内参照です。実コメントURL・実承認・実commitはありません。実導入時は確認可能な記録へ置換します。

## 先に定義する確認ケース

各行で「入力を置き換える→手順を辿る→期待と照合する」の順に確認します。ケース同士は独立です。P01の時系列に他ケースの障害を混ぜません。

| ID / AC | 入力・操作 | 期待記録・期待停止 |
| :--- | :--- | :--- |
| P01 / AC1〜5 | 前提を満たし割当→claim→heartbeat→PR review→完了 | 下の正常例の順。ownerは1人、claimは1件、review中も枠1。終了確定後に枠0。completedには契約/検証の確認が必要 |
| P02 / AC1,3 | designの承認待ち。まだclaimなし | in_reviewにreview対象とcurrent stage、claimなしを記録。承認/claim/branch確認前にimplementationへ進まない。既存claimがあれば同じclaimを保持 |
| P03 / AC1,3 | 依存未完了または必須承認なし | available/claimを確定しない。draftまたはblockedの理由と不足根拠を記録。wave/passで通さない |
| P04 / AC2,3 | assigneeが別人、またはbotのon_behalf_of/依頼根拠不明 | 新claimを停止。対象ownerと依頼関係を人間へ照会し、AIをassigneeにしない |
| P05 / AC3,4 | partial inventory、古いsnapshot、未知permission、またはaliceに別active claim1件 | 新規担当を停止。complete/最新事実を確認して元入力から再検査。空配列/eligible結果を許可の代わりにしない |
| P06 / AC3 | 同waveの別Issueがcontractsの同一/祖先pathを変更。複数areaのCoordinatorが関係 | integration ownerと関係Coordinatorが調整し操作担当を1人へ。直列化または承認されたscope分割までclaimしない |
| P07 / AC4 | 最終明示heartbeatから24時間を超えたがPRは更新 | stale警告。PR更新をheartbeatに置換せず枠1を保持。本人/branch/PR確認後に継続heartbeatまたは保留。無応答だけでreleaseしない |
| P08 / AC1,4 | claim中にpause、blocked、in_review、またはmember inactive | 更新記録に状態と理由を追記。pauseを第9のproject statusにしない。全量inventoryにclaimを残し枠1、役割のみのcoord/ownerには枠加算なし |
| P09 / AC4,5 | 同じownerが中断から再開 | 元claimとbranch/commit/stateを照合し承認・依存・競合を再確認。新claimを作らず追加枠0。current stageを飛ばさない |
| P10 / AC2,5 | aliceからbobへ担当変更。bobは全担当条件と空き枠を確認済み、旧作業は停止/保存・引継受領済み | 旧claimの解除依頼だけでは枠を空けない。Coordinatorの解除確定後にassignee/引受を確認、新claim_idで開始。旧記録を編集/削除しない |
| P11 / AC5,6 | 再割当したいが未push変更の有無/所在が不明 | blocked、解除/再割当を保留。branchの存在だけで引継済みにしない。秘密/生diffをコメントへ転載しない |
| P12 / AC3,6 | coordからcoord-nextへCoordinator交代 | 旧担当の更新停止→未完了操作/全active claim引継→新担当受領→設定PR反映を確認して切替。既存claimのownerは変えない |
| P13 / AC6 | 同record_idの同内容再投稿、または異内容。同operation_idで別record_idの準備→確定も比較 | 同record_id・同内容は同記録として参照し二重claim/枠消費をしない。同record_id・異内容や同試行内の競合は停止。前記録を参照した正当な準備→確定追記は許容。自動冪等性を主張しない |
| P14 / AC1,3,6 | branchだけ作成成功、claim投稿の応答不明、status更新は失敗 | reconciliationへ成功/失敗/不明を分け記録。新規作業を保留。現コメント/branch/assignee/labelsを再取得してから再送/補完/取消を判断 |
| P15 / AC1,6 | 既存claimなしbranch、claimありbranchなし、またはstatus用labelが0/複数/未知 | orphan/不整合として停止。勝手にbranch作成/削除、label修正、claim取得をしない。人間が根拠と現状を照合 |
| P16 / AC1,6 | GitHubはcompletedだが内部stage/必須検証が未完、またはassigneeだけ変更 | 自動完了/owner変更にしない。停止し更新時刻・承認・claim・stateを照合。closeのみ、PR未merge closeのみでも完了を推測しない |
| P17 / AC1,5,6 | 人間が取消、または解消不能で従来運用へ戻す | cancel判断と残作業・claim終了を個別に記録。新規割当を止め旧記録を保持してfallbackを明示。終端から再開は再契約と新claim |
| P18 / AC2,7,9 | 様式にplaceholder残り、または導入していない単一Issue project | 未置換記録を確定に使わない。導入なしでも従来運用を継続。様式v1をschema_versionや自動処理契約と誤認しない |

## P01の記入例

読みやすさのため各様式の記入内容を表で示します。実運用ではテンプレートの共通欄（record_id、operation_id、時刻、actor、Issue/work_id、evidence_refs）も埋め、GitHub Issueコメントへ追記します。
合成IDはこの文書内だけで有効です。以下は権限・承認の実証ではありません。

### example-record-assignment

| 項目 | 記入内容 |
| :--- | :--- |
| record_id / operation_id | example-assignment-42 / example-assign-op-42 |
| recorded_at / actor | 2026-10-29T09:00:00Z / human:coord |
| Issue / work_id | https://github.com/example/project/issues/42 / issue-42 |
| human_owner / collaborators | alice / なし |
| Coordinator / primary agent / integration owner | coord / codex-session-example / backendは非共有・既定ownerなし（該当なし） |
| scope / non_scope | backend: packages/backend/profile/ / docs/api/、他feature |
| evidence_refs / 引受 | この文書の「合成の前提」 / aliceの引受確認を09:00に行ったという合成事実 |
| 確認する操作 | assignee=aliceを読み戻し、project statusをassignedへ。claimなし、capacity0 |

### example-record-claim

| 項目 | 記入内容 |
| :--- | :--- |
| record_id / operation_id / claim_id | example-claim-record-42-a / example-start-op-42-a / example-claim-42-a |
| recorded_at / actor / on_behalf_of | 2026-10-29T09:05:00Z / ai_agent:codex-session-example / alice |
| Issue / work_id / human_owner | https://github.com/example/project/issues/42 / issue-42 / alice |
| evidence_refs / assignment_ref | example-record-assignment / example-record-assignment |
| branch / base_commit | feature/42-profile / 実導入時に確認する40桁commit（この合成例に実commitなし） |
| agent / primary / integration owner | codex-session-example / codex-session-example / 該当なし（backend非共有） |
| scope / non_scope | backend: packages/backend/profile/ / docs/api/、他feature |
| claimed_at / last_heartbeat_at | 2026-10-29T09:05:00Z / 2026-10-29T09:05:00Z |
| policy / confirmation | project.yaml revision1、heartbeat_interval_seconds=14400、stale_after_seconds=86400、on_stale:warn、release_policy:manual / coordが直前確認と確定を承認したという合成事実 |
| 確認する操作 | branch/claim/assigneeを読み戻しstatus=in_progress。全更新の一致確認後に作業開始、active claim1件、capacity1 |

### example-record-heartbeat

| 項目 | 記入内容 |
| :--- | :--- |
| record_id / operation_id / recorded_at | example-heartbeat-42-a / example-heartbeat-op-42-a / 2026-10-29T12:00:00Z |
| actor / on_behalf_of / Issue / work_id | ai_agent:codex-session-example / alice / https://github.com/example/project/issues/42 / issue-42 |
| claim_id / previous_record_ref / evidence_refs | example-claim-42-a / example-record-claim / example-record-claim |
| update / last_heartbeat_at / stage | heartbeat / 2026-10-29T12:00:00Z / tests |
| branch/HEAD/PR・検証 | feature/42-profile、確認済み作業commitへの参照（合成）、PRなし、先行テストの失敗記録への参照（合成） |
| blocker / 次 | なし / 承認済み設計とテストに従いimplementationへ |
| 確認する操作 | 同claimを保持。status=in_progress、capacity1。heartbeat期限はこの明示時刻から計算 |

### example-record-review

| 項目 | 記入内容 |
| :--- | :--- |
| record_id / operation_id / recorded_at | example-review-42-a / example-review-op-42-a / 2026-10-29T15:00:00Z |
| actor / on_behalf_of / Issue / work_id | ai_agent:codex-session-example / alice / https://github.com/example/project/issues/42 / issue-42 |
| claim_id / previous_record_ref / evidence_refs | example-claim-42-a / example-record-heartbeat / example-record-heartbeat |
| update / stage / review対象 | review / review / 作業PR（合成参照） |
| branch/HEAD/検証 / last_heartbeat_at | feature/42-profile、最終commit/検証成功参照（合成） / 2026-10-29T15:00:00Z |
| blocker / 次 | 人間レビュー待ち / 指摘確認、承認後の完了確認 |
| 確認する操作 | status=in_review、claimは保持、capacity1。PR作成だけでは終了しない |

### example-record-release

| 項目 | 記入内容 |
| :--- | :--- |
| record_id / operation_id / recorded_at | example-release-42-a / example-release-op-42-a / 2026-10-29T16:00:00Z |
| actor / Issue / work_id | human:coord / https://github.com/example/project/issues/42 / issue-42 |
| claim_id / previous_record_ref / evidence_refs | example-claim-42-a / example-record-review / example-record-review、人間の完了確認（合成） |
| decision / reason / released_at | 解除確定 / 契約・必須検証・人間reviewを完了 / 2026-10-29T16:00:00Z |
| 最終作業/引き継ぎ | feature/42-profile、最終commit/merge済みPR/Issue state参照（合成）、未push変更なしをaliceへ確認済み、残作業なし、引継先/新claimは該当なし |
| 確認する操作 | 終了記録の実在・停止・未pushなしを確認後inventoryから除外、capacity0。完了根拠を確認してstatus=completed。解除だけでは完了しない |

## P10・P14の追記例

P10では同じexample-claim-42-aに対し、解除依頼のrecordと、人間coordによる解除確定の別recordを追記します。
理由は「bobへの再割当」、旧作業停止・最終commit・未push保存先・state再開地点・bobの引継受領参照を揃えます。
解除確定を確認した後にassignmentをbobへ変更して引受を再確認し、example-claim-42-bを発行します。新claimのevidence_refsは旧解除確定recordを指します。
後から新claimが確定した際も旧コメントを上書きせず、更新記録で両claimを関連付けます。旧作業や引継受領が不明ならP11へ戻ります。

P14のreconciliation記録は「branch成功、claim投稿の応答不明、label失敗、全操作未確定」と書きます。
同じoperation_idのコメントが既にあるか、branch/assignee/labelを人間が読み戻します。同内容のclaimが見つかっても照合完了まで新作業は止めます。
確認後、同じ試行の不足操作だけを補完して根拠を追記するか、準備を中止しbranch/claimの扱いを人間が決めます。claimが確定済みなら通常の解除手順を通します。
応答不明のまま新しいclaim_idで開始したり、branchを無断削除したりしません。

## 確認記録の取り方

PRではP01〜P18それぞれの期待動作を手順・様式と照合した結果を記録します。確認できない行は未確認のまま残します。
机上確認の成功を、GitHub上の原子的排他・実権限・本人引受・本番障害復旧や自動テストの成功と読み替えません。
既存900テスト・Golden12ケース・保存Issue検査の実行結果は別に報告します。
