# 操作の照合・復旧記録

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈この照合の記録ID〉 / 〈照合する元操作の試行ID〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈現状・操作結果・人間判断を確認できる参照〉 |

| 照合欄 | 記入値 |
| :--- | :--- |
| decision / previous_record_refs | 〈照合中または解消確認〉 / 〈元操作/重複/直前照合の全関連記録URL〉 |
| coordinator / human_owner / claim_refs | 〈今回の操作担当〉 / 〈責任者、不明なら不明〉 / 〈競合を含むclaimの参照、なければなし〉 |
| expected_state | 〈元操作が意図したassignee/status/claim/branch/PR/state〉 |
| observed_at / observed_state | 〈現状を読み戻したUTC〉 / 〈実assignee/status全label/claim/branch/PR/内部stage〉 |
| succeeded / failed / unknown | 〈確認済み成功操作〉 / 〈確認済み失敗操作〉 / 〈応答不明や確認不能。各々なければなし〉 |
| duplicate_ids / conflicting_content | 〈同一record/operationの重複〉 / 〈内容の不一致、なければなし〉 |
| unpushed_work / checkpoint_ref | 〈旧作業の保存・停止・引継確認、不明なら明記〉 / 〈内部stateと再開地点〉 |
| stop_scope / inventory_treatment | 〈止めるIssue/共有area/操作〉 / 〈確定前は空きとせず予約・既存枠を保守的に保持〉 |
| resolution / human_decision_ref | 〈不足操作の補完/継続/取消/保留と理由〉 / 〈解消を確認した人間の記録参照〉 |
| final_readback / next_action | 〈解消後の実状と確認時刻。未解消なら未解消〉 / 〈次の安全な操作〉 |

応答不明を未実行と決めつけて再送しません。同record_idの異内容や同試行の競合・二重claimは人間の照合まで停止します。同operation_idでも別record_idによる準備→確定等の正当な追記は区別します。解消記録だけで既存claimを解除せず、解除には専用の確定記録を残します。
