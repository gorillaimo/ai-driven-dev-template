# 着手（claim）の記録

| 共通欄 | 記入値 |
| :--- | :--- |
| record_id / operation_id | 〈記録ID〉 / 〈着手試行ID〉 |
| recorded_at | 〈UTC日時〉 |
| actor_type / actor_ref / on_behalf_of | 〈記録主体の種別〉 / 〈主体ID〉 / 〈依頼元人間または該当なし〉 |
| issue_ref / work_id | 〈実Issue URL〉 / 〈issue-実番号〉 |
| evidence_refs | 〈人間の確定・依頼・最新確認の参照〉 |

| 着手欄 | 記入値 |
| :--- | :--- |
| decision / previous_record_ref | 〈準備中または確定〉 / 〈同試行の準備/照合記録、初回ならなし〉 |
| claim_id / assignment_ref | 〈一意の着手ID〉 / 〈現在の担当割当確定記録URL〉 |
| human_owner / agent_ref | 〈責任を持つ人間1人〉 / 〈AIツール/agent識別子〉 |
| coordinator / confirmation_ref | 〈今回の操作担当〉 / 〈Coordinatorまたは割当済み人間ownerの明示確定・依頼根拠〉 |
| branch / base_commit | 〈実在するIssue branch〉 / 〈確認した40桁base commit〉 |
| area_ids / file_scope / non_scope | 〈担当area〉 / 〈変更可能path/prefix〉 / 〈非担当領域〉 |
| primary_agent / integration_owner | 〈primary agent〉 / 〈areaごとの人間統合責任者、該当なしなら理由〉 |
| claimed_at / last_heartbeat_at | 〈確定時UTC、準備中なら未確定〉 / 〈明示確認したUTC〉 |
| project_policy_ref | 〈project.yamlのrevision/commit、claim_policyへの参照〉 |
| heartbeat_interval_seconds / stale_after_seconds | 〈合意したheartbeat間隔秒〉 / 〈合意したstale閾値秒〉 |
| stale_warning_after | 〈last_heartbeat_at + stale_after_secondsと比較する警告境界UTC。超過で警告〉 |
| preflight_refs | 〈直前の契約・承認・依存・member/permission・全量claim/capacity・他PR/branch/未push・scope競合確認〉 |
| readback | 〈assignee/claim/branch/対象commitが一致した確認時刻・根拠〉 |
| project_status_before / after | 〈変更前〉 / 〈実状に合う変更後とlabel読み戻し結果〉 |
| start_confirmation / unresolved | 〈全操作一致後の開始確認、未一致なら開始保留〉 / 〈未解決、なければなし〉 |

同一Issueの競合claim・他人assignee・不明な代理では確定しません。準備中/部分失敗/読み戻し不一致では新作業を止め、照合記録へつなぎます。
