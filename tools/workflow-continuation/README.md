# workflow-continuation（P7実験用host library）

認証した継続依頼から、P4の候補選択・予約、P5の実行/修正、P6の統合検証を順に呼ぶ制御部品です。現在は**合成host専用**です。native/production adapter、会話サービスへの接続、実モデル起動、実GitHubへの新しい自動投稿は提供しません。

Node.js 22以上が必要です。利用先アプリの開発言語は問いません。合成E2Eで使う既存P4/P5台帳にはLinux/Python/SQLiteも必要です。通常の会話開発の利用条件は変わりません。

```sh
# P3〜P6の既存packageも同じcommitのlockfileから準備する。
npm ci --prefix tools/workflow-continuation --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-continuation
```

## API

- `validateContinuationArtifact(kind, value)`：profile/request/decision/checkpoint/reportの形式確認。
- `planContinuation({profile, inventory, state, requested_issues, now})`：副作用なし。`state`はcheckpointまたはnull。`requested_issues: null`は許可済み候補から選択。全量入力を既存P4 `planBatch`へ渡し、優先順位・依存・共有領域・担当・枠の条件を維持する。
- `createSyntheticContinuationAdapter(ports)`：trusted hostがportを登録し、不透明なhandleを作る。worker JSONやrepo文書からこのfactoryを呼び出す口を作らない。
- `openContinuation({directory, profile, adapter, clock})`：repo外の専用private directory（0700）を使用。`accept(request, {drive: true, wait: true}) / tick() / status() / stop() / reconcile() / close()`を返す。
- `renderContinuationReport(report)`：型を検査した値から32 KiB以内のMarkdownを生成する。

既定のacceptは候補がなくなる等の区切りまで観測を続けます。`wait:false`は同じhostプロセス内のバックグラウンド実行、`drive:false`はhost/試験からtickを明示する方法です。プロセス終了後の常駐を保証する仕組みではありません。`status()`は最後に保存できた状態を返し、実行を止めません。外部依頼は`accept`でhostの本人確認を通します。直接のstop/reconcileはtrusted hostの管理APIです。

## 合成hostのport契約

すべてのportはAbortSignalを受け取ります。タイムアウトや停止後に新しいworker・外部更新を始めず、operation_idの重複を照合してください。callback登録自体が信頼の起点です。JSONの`allowed:true`を本人性証明にしません。

| port | 入出力とhostの責務 |
| --- | --- |
| authorizeRequest | profile/requestのbinding_digestを確認。mode:synthetic、allowed、同digest、observed_atを返す。sourceの本人確認はhostが独立に行う |
| observe | `dispatcher_input / observed_at / main_sha / worker_count`。候補・claim・PR・権限等の全量を省略しない |
| reserve | 指定Issueを実P4の原子的予約へ渡す。status:passedと`reservations[{claim,handle}]`。P7は別のclaim台帳を作らない |
| revalidate | reservationのP4 handleを再照合。status:passed以外は停止 |
| start | 予約済み対象をP5の**新しいbatch**へ接続し、host内handleを返す。同じP5 envelopeを新batchとして再利用しない |
| poll | runningとworker_count、またはcomplete/worker_stopped/usage/items。usageはknownのcalls/cost_units。itemsはIssue/claim/head/plan/PR/status/repairsと4工程のproofs |
| integrate | main/targets/profileのpinsをP6で検証。status、同じpins、保護evidence_refsを返す。任意のrecommended_merge_orderは同じ対象のP6順序だけ。失敗/失効/未評価をpassedにしない |
| notify | kind/report/summary/report_digest。公開成否を読戻し、confirmed:trueと同digestを返す。実GitHubの新しい一般run投稿は未接続 |
| stop | parent runの新規起動をfenceし、起動途中も含む全batchを停止。stopped:trueは停止を確認した場合だけ |
| reconcile | state_digestへ束縛し、observed_at、workers_stopped、operations_reconciled、未精算batchのsettlementsを返す。不明操作を再送して確認したことにしない |

proofはstage（implementation/verification/review/security）、status、head_sha、plan_digest、execution profile_digest、context_id、evidence_refsへ束縛します。実装とレビューのcontextは別にします。欠落や未実行はレビュー可能にしません。修正はP5の同じIssue/branchの巡回に含め、3巡を超えたり進展がなければ保留します。P6の修正要求は保護結果へ残し、元Issueで扱います。合成portの結果は、実scannerや実AIを実行した証明にはなりません。

## 保存・停止・再開

`continuation.jsonl`はdigest chain付きcheckpoint、`record-<digest>.json`は不変の詳細記録です。状態はrunning/waiting/stopped/reconcile_required/finishedを区別し、Issueごとの保留・統合待ち・review_readyも記録します。現在の有限runは候補待ちでwaiting、停止を確認するとstoppedになります。finishedは契約上の終了状態として予約しています。

副作用はintent→sending→confirmed/unknownを保存します。不明利用量の予約は保持し、PR作成だけでclaimや依存を解除しません。マージ・worker停止・利用量/公開成否・P4解除をhost側で確認します。再起動はreconcile_requiredから始め、照合後の新依頼でも同じparent runの期限・総件数・合算利用量を維持します。lockだけを削除して再開しないでください。

停止後は新しい外部通知を送らず、返却reportと保護checkpointへ理由を残します。保存先故障・上限では記録を成功扱いにせず、新規作業を止めます。host喪失後の自動cleanup、保管期限、native権限委譲・実利用量・一般run公開は未評価です。

hard capと責務の正本は[共通設計10.1](../../docs/common/autonomous-development-design.md#101-継続制御の実験実装continuationv1)。schema適合は実行許可や人間承認を意味しません。#52の実運用接続・実モデル試行、保留中#66、production採用、無人運転、v2 stableは別の判断です。
