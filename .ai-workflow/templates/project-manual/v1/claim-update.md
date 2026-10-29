# claimの更新

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈記録ID〉 / 〈更新試行ID〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈更新理由・人間承認/依頼・検証等の参照〉 |

| 更新欄 | 記入値 |
| :--- | :--- |
| claim_id / previous_record_ref | 〈既存claim ID〉 / 〈直前の有効記録URL〉 |
| human_owner / update | 〈現在の人間owner〉 / 〈heartbeat / pause / block / resume / reviewから目的を選択〉 |
| current_stage / state_ref | 〈Issue内部の実stage〉 / 〈state/checkpointと対象commit参照、未採用なら理由〉 |
| branch / head_commit / pr_ref | 〈確認したbranch〉 / 〈実HEAD〉 / 〈PR参照、なければなし、不明なら不明〉 |
| last_heartbeat_at / stale_warning_after | 〈今回明示確認したUTC、確認していなければ前の時刻を保持〉 / 〈policyに基づく警告境界UTC〉 |
| project_policy_ref | 〈project revision/commitとheartbeat/stale方針の参照〉 |
| completed_work / validation_refs | 〈今回の進捗〉 / 〈実行検証と成否の参照、未実施なら明記〉 |
| blocker / review_target | 〈阻害要因、なければなし〉 / 〈設計承認/PR等の対象、review以外なら該当なし〉 |
| resume_preflight_refs | 〈resume時の同owner/claim/branch・依存/承認/権限/競合・再開stage確認、他更新なら該当なし〉 |
| project_status_before / after | 〈変更前〉 / 〈根拠と実label読み戻し。pauseはblocked等の既存8値で表現〉 |
| next_action / claim_relation_refs | 〈次の安全な作業〉 / 〈後続claim/解除等との関連、なければなし〉 |
| capacity_note | 〈解除確定まではactive inventoryに残す。現在の担当数/上限と確認参照〉 |

更新は解除や再取得ではありません。paused/blocked/in_review/inactive/staleでも枠を保持します。既存claimを別ownerに書き換えません。
