# claimの解除・引き継ぎ

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈記録ID〉 / 〈解除試行ID。依頼と確定で共通〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈旧作業停止・人間の解除/終了判断と引き継ぎ確認参照〉 |

| 解除欄 | 記入値 |
| :--- | :--- |
| claim_id / previous_record_ref | 〈解除する旧claim ID〉 / 〈直前の更新/解除依頼/照合記録URL〉 |
| human_owner / releasing_coordinator | 〈旧人間owner〉 / 〈解除を確定する人間Coordinator〉 |
| decision / reason | 〈解除依頼または解除確定〉 / 〈完了/取消/担当変更等の理由〉 |
| release_confirmation_ref / released_at | 〈人間の確定根拠、依頼段階は未確定〉 / 〈実解除UTC、依頼段階は未確定〉 |
| stopped_work_ref | 〈旧owner/agentの更新停止を確認した参照〉 |
| branch / head_commit / pr_ref | 〈最終branch〉 / 〈最終commit〉 / 〈PRとmerge/close等の実状態〉 |
| unpushed_work | 〈なしの確認、または保存済み参照と受領確認。不明なら解除/再割当保留〉 |
| state_checkpoint_ref / remaining_work | 〈内部state/再開地点の参照、未採用なら理由〉 / 〈残課題・検証・リスク、なければなし〉 |
| handoff_to / acceptance_ref | 〈引継先人間、不要なら理由〉 / 〈受領の確認参照、不要なら理由〉 |
| replacement_claim_ref | 〈新claim URL。未作成なら未作成とし、確定後は別の追記で関連付ける。完了等で不要なら理由〉 |
| project_status_before / after | 〈変更前〉 / 〈完了/取消/再割当準備などの根拠と実label読み戻し〉 |
| inventory_confirmation | 〈解除確定の実在を確認した時刻/根拠。依頼段階では枠保持〉 |
| unresolved / next_action | 〈未解決、なければなし〉 / 〈次の操作〉 |

解除依頼はactive claimを解放しません。旧解除確定・停止/引継確認前に新claimを開始しません。解除だけでIssueをcompletedにしません。
