# Coordinator交代の記録

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈記録ID〉 / 〈交代試行ID〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈交代を管理する実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈旧/新担当の確認、承認と設定変更参照〉 |

| 交代欄 | 記入値 |
| :--- | :--- |
| decision / previous_record_ref | 〈交代準備または交代確定〉 / 〈準備/照合等の前記録、なければなし〉 |
| old_coordinator / new_coordinator | 〈旧人間Coordinator〉 / 〈新人間Coordinator〉 |
| project_id / area_ids | 〈project ID〉 / 〈対象area、project全体なら全体と明記〉 |
| old_writer_stopped_at / confirmation_ref | 〈旧担当が割当更新を止めたUTC〉 / 〈停止確認参照〉 |
| pending_operations | 〈未完了操作IDと成功/失敗/不明の参照。なければなし〉 |
| active_claim_refs / uncertain_conflicts | 〈対象範囲の全active claim/Issue/ownerの参照〉 / 〈未確定・競合、なければなし〉 |
| handoff_ref / new_acceptance_ref | 〈未push/branch/PR/内部stateを含む引継参照〉 / 〈新担当の受領確認〉 |
| project_team_change_pr / applied_commit | 〈project/teamの承認済み設定変更PR〉 / 〈反映済みcommit。準備中は未反映〉 |
| effective_at / readback | 〈確定した切替UTC、準備中は未確定〉 / 〈現設定・単一操作担当・旧担当停止の読み戻し〉 |
| unresolved / next_action | 〈未解決、なければなし〉 / 〈次の安全な操作〉 |

未完了操作の責任は明示して引き継ぎます。設定反映・受領・旧担当停止を確認するまで新担当の割当更新を始めません。既存claimのhuman_ownerは変更しません。
