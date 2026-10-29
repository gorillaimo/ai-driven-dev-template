# 担当割当の記録

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈記録ID〉 / 〈割当試行ID〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈契約・承認・依頼と最新事実の確認参照〉 |

| 割当欄 | 記入値 |
| :--- | :--- |
| decision / previous_record_ref | 〈準備中または確定〉 / 〈前の割当/解除/照合記録、なければ理由〉 |
| human_owner / collaborators | 〈責任を持つ人間1人〉 / 〈協力者・役割、なければなし〉 |
| coordinator / area_agreement_refs | 〈今回の操作担当1人〉 / 〈関係する全areaのCoordinatorの合意参照〉 |
| area_ids / file_scope | 〈担当area〉 / 〈変更可能な相対path/prefix〉 |
| non_scope | 〈変更しない領域・ファイル・作業〉 |
| primary_agent / integration_owner | 〈primary agent識別子〉 / 〈areaごとの人間統合責任者、非共有で既定なしなら該当なしの理由〉 |
| owner_override_ref | 〈Issue限定上書きの対象area/人間/Coordinator approval参照、または該当なし〉 |
| project_refs | 〈承認済みproject/team/delivery-planのrevisionとcommit参照〉 |
| contract_dependency_approval_refs | 〈ready-for-ai・依存完了・必須承認/Quality Gatesの確認参照〉 |
| member_capacity_scope_refs | 〈現在の人間/権限/必要Team・全量claim・同時担当上限・他PR/branch/scope確認。validator利用時は元入力/観測時刻/結果も参照〉 |
| responsibility_confirmation | 〈人間ownerの引受・AIへの依頼を確認した参照〉 |
| assignees_readback / active_claims | 〈読み戻した実assigneeと主責任者の一致〉 / 〈対象Issueの既存claim有無・参照〉 |
| project_status_before / after | 〈変更前〉 / 〈変更後。確定後はassigned等、実状と根拠に合わせる〉 |
| next_action / unresolved | 〈次の操作〉 / 〈未解決、なければなし〉 |

準備中や不明のある記録でclaimを開始しません。確定してもactive claimとbranchの確認までは着手できません。
