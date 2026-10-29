# 手動Coordinator用コメント様式 v1

GitHub Issueコメントにコピーし、人間が確認して使うMarkdownです。Coordinatorは担当割当と競合を調整する人、claimは誰がどの範囲に着手するかの記録です。
[運用手順](../../../../docs/common/manual-coordinator.md)を先に読み、[机上例](../../../../docs/examples/project-manual/walkthrough.md)で確認してください。

| 様式 | 使う場面 |
| :--- | :--- |
| [assignment.md](assignment.md) | 人間ownerの割当・引受、scope、統合責任を確定する |
| [claim.md](claim.md) | branchと直前条件を確認して着手記録を確定する |
| [claim-update.md](claim-update.md) | heartbeat、pause、block、resume、reviewを追記する |
| [claim-release.md](claim-release.md) | 解除依頼と人間による解除確定、引き継ぎを記録する |
| [coordinator-handoff.md](coordinator-handoff.md) | Coordinatorの交代を準備・確定する |
| [reconciliation.md](reconciliation.md) | 部分失敗や不整合の現状・停止範囲・解消を記録する |

## 記入・追記の約束

1. 必要な様式をコピーし、`〈…〉`をすべて置換します。選択欄は1つ選びます。該当しない欄は理由付きで「該当なし」、確認不能は「不明」と書き、確定に必要な不明があれば停止します。未置換の見本を実記録として使いません。
2. 全様式の共通欄を記入します。対象Issue/work_idはコメントを置く実Issueに一致させます。GitHub Issue番号は実際に発行された番号を使います。
3. record_idは追記する記録ごと、operation_idは割当/着手/解除などの試行ごとに一意にします。同じ操作の準備・確定・照合は同じoperation_idで関連付け、各追記には別record_idを使います。同内容の通信再送だけは同record_idを使い、人間が重複を照合します。別操作には新IDを使います。
4. recorded_atは記録時刻をUTCのISO 8601（例`2026-10-29T09:00:00Z`）で書きます。claimed_at/released_at等の操作時刻と混同せず、未来の時刻で確定しません。
5. actor_typeは既存共通定義のhuman/ai_agent/bot/systemに合わせ、actor_refは実際の記録主体です。AI/botはon_behalf_ofに人間loginとevidence_refsに依頼根拠を必ず残します。humanの場合はon_behalf_ofを「該当なし」とできます。human_ownerは常に責任を持つ人間1人です。
6. evidence_refsには契約・人間承認・最新確認のコメント/レビューURL、またはcommitを特定したfile参照を記入します。actorや承認欄の自己申告は本人性の証明ではありません。本人・権限・引受は人間が別に確認します。
7. 前のrecord/claim/assignmentをURLでつなぎ、訂正・解除・再割当は追記します。旧記録を編集・削除して履歴を消しません。project statusの変更前後と理由も残します。
8. token、credential、個人メール、端末情報、勤務事情、本番データ、生ログは記入しません。未push変更は保存状況と権限のある参照だけを記録し、内容を転載しません。

claim_idは着手試行ごとに一意です。同じowner/claimの再開では維持し、解除後の新着手・担当変更では新IDにします。
branch、HEAD/base_commit、PR、Issue内部stateは実在と対象を確認します。「なし」と「存在を確認できない」を分けてください。
claim-updateのheartbeatは明示的に確認した時刻です。別コメントやPR更新から推測して補いません。

## 様式の版と保証範囲

このv1は人間向けコメント様式の版です。schema_version、Project YAML v1、checker_version、template本体のVERSIONとは別です。parser/reducerが読む機械契約ではなく、この欄を既存schemaへ追加しません。
project/team/delivery-planの静的台帳は[project/v1](../../project/v1/README.md)を使い、実assignee/claim/statusを台帳や共有stateへ複製しません。
様式の記入やvalidatorのpassだけで着手を許可しません。確定記録の実在、現在の担当・branch・承認・競合を読み戻してから作業します。
GitHubコメント・assignee・label更新を原子的に確定する仕組みや、自動排他・冪等処理・自動stale解放は提供しません。
任意導入です。採用しない単一Issue運用と既存のAGENTS.md/development-rules.mdのalways-onルールは継続できます。
