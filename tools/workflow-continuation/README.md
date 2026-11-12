# workflow-continuation（任意の判断補助 / P7実験用host library）

設定・観測値から上限を判定する任意の関数と、認証した継続依頼からP4予約・P5実行/修正・P6統合を呼ぶ**合成host専用**の実験部品を提供します。native/production adapter、会話サービスへの接続、実モデル起動、実GitHubへの新しい自動投稿は提供しません。

Node.js 22以上が必要です。利用先アプリの開発言語は問いません。合成E2Eで使う既存P4/P5台帳にはLinux/Python/SQLiteも必要です。通常の会話開発の利用条件は変わりません。

```sh
# P3〜P6の既存packageも同じcommitのlockfileから準備する。
npm ci --prefix tools/workflow-continuation --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-continuation
```

<a id="budget"></a>

## 上限と停止条件の判断補助

`decideContinuationBudget({policy, observation, run, now})`は同期の純粋関数です。入力だけから助言を返し、関数内でファイル・時計・残量を取得せず、通信/command・AI起動・停止・保存を行いません。module import時は既存依存と同梱schemaを読みます。同じcommitの関連packageを準備して使い、通常の会話開発での採用は任意です。

```js
import { decideContinuationBudget } from './tools/workflow-continuation/controller.mjs';
const result = decideContinuationBudget({
  policy: {
    schema_version: 1, artifact_kind: 'autonomy-settings', revision: 1,
    limits: { issues: 2, minutes: 60, parallel_issues: 1, repair_rounds: 2 },
    quota: { stop_new_remaining_percent: 30, checkpoint_remaining_percent: 15 },
  },
  observation: { status: 'unsupported' },
  run: {
    started_at: '2026-11-12T00:00:00Z', last_checked_at: '2026-11-12T00:00:00Z',
    issues: [{ number: 1, repair_rounds: 0 }], active_issues: [], active_agents: 1,
    stop_requested: false, authorization_lost: false, storage_failed: false, work_unknown: false,
  },
  now: '2026-11-12T00:10:00Z',
});
console.log(result.decision); // continue（残量は不明のまま）
```

上は合成例です。実運用では承認済みの設定と確認した累積・時刻・観測を呼出し元が渡します。`policy`は[settings v1](../../.ai-workflow/schemas/autonomy/v1/settings.schema.json)の完全な値で、型/範囲と閾値順序・並列数の横断条件を検査します。初期値補完、今回指定との解析/合成、設定ファイルloaderはありません。

| 入力 | 必須項目・条件 |
| --- | --- |
| `run` | 例の全項目。`started_at ≤ last_checked_at ≤ now`、全時刻はRFC3339。`issues`は総着手の最大10件、正の安全な整数の`number`と整数0〜3の`repair_rounds`。番号重複不可。保留/失敗も除外しない |
| 稼働作業 | `active_issues`は着手済み番号の重複しない部分集合（最大2件）。`active_agents`は整数0〜3。4つの状態flagはbooleanで、trueなら保存優先 |
| `observation: unsupported` | `{status:'unsupported'}`だけ。最初から取得非対応の場合に使い、残量nullで件数/時間方式にする |
| `observation: unavailable` | `{status:'unavailable',retry_count:0\|1}`。取得故障。0は新規停止・1回の再確認待ち、1は保存優先。関数自身はretryしない |
| `observation: available` | `status,retry_count,observed_at,expected_scope,observed_scope,windows,warning,exhausted`をすべて渡す。warning/exhaustedはboolean |
| 観測対象 | `expected_scope:{account_ref,workspace_ref,window_ids}`と`observed_scope:{account_ref,workspace_ref}`。参照は空白だけ不可・最大128文字、window IDは最大64文字。必要枠は1〜16件・重複不可 |
| 観測値 | `windows:[{id,metric,value}]`。metricは`used_percent`または`remaining_percent`、valueは有限の0〜100（小数も可）。必要枠を全件・各1回だけ渡す。観測はnow以前の60秒以内 |

全体はJSON表現で16KiB以内、既存JSON検査の深さ32・要素数上限内。未知field・不正な構造・非JSON/accessor/proxy/cycleを拒否し、`budget_input_invalid`等で保存優先とします。構造が揃った観測でも対象/枠・値・鮮度が不適合なら`budget_quota_unknown`とし、retry_countで新規停止/保存優先を分けます。故障をunsupportedへ自動変更しません。

| 出力 | 読み方 |
| --- | --- |
| `schema_version:1` / `artifact_kind:autonomy-budget-decision` / `authority:false` | この任意APIの戻り値。既存continuation/v1成果物とは別で、保存schemaや実行許可を追加しない |
| `decision` | `continue` / `stop_new` / `checkpoint`。保存優先が最優先。stop_newは一部の操作が制限された状態で、すべての作業の禁止とは限らない |
| `can_start_issue` / `can_start_agent` | 予算上の候補。Issue総数/並列枠とagent枠を分ける。Issue上限だけで既存Issueの必要なレビュー用agentを一律に禁止しない |
| `held_issues` / `repairable_issues` | 修正上限に達した着手Issueと、予算内で修正巡回を始められるactive Issue。番号順。局所保留で独立Issueを一律に止めない |
| `stop_new_at` / `deadline_at` | 開始からの期限と、その10分前。時刻不明/不正入力ならnull。関数が実際に停止させた証拠ではない |
| `remaining_percent` | 正しい全関連枠の最小残量。usedからは100-valueで変換。不明/非対応はnull |
| `reason_codes` | 非機密な固定codeを順序固定・重複なしで返す。不正入力/設定/時計、停止/権限/保存/旧作業、期限/保存余裕、残量critical/low/unknown、Issue/並列/agent/修正上限の順 |

初期値では50分以降に新規Issue/agent/修正巡回を止め、60分以降は保存優先です。残量30%以下は新規停止、15%以下・警告/枯渇は保存優先。同時に該当する理由は併記します。新規停止中の進行中工程の完了余裕は見積もらず、呼出し元が安全な保存点を判断します。

不正な設定は`budget_policy_invalid`、不正/逆行する時計は`budget_clock_invalid`、残量は`budget_quota_critical/low/unknown`、上限は`budget_issue_limit/parallel_limit/agent_limit/repair_limit`等を返します。原文やaccount/workspace IDを診断に転載しません。

助言のtrue/continueは担当・承認・依存/競合・分割承認・環境能力・必須検査/独立レビューの代替にはなりません。入力の真正性、過去履歴からの無断reset・故障から非対応への偽装も、単一snapshotの関数では検出を保証できません。既存hostや[会話手順](../../docs/common/development-rules.md#continuation-procedure)へ自動接続していません。

`npm test --prefix tools/workflow-continuation`は、既存合成E2Eと`P7 Budget`の境界・非変更/副作用なし試験を実行します。残量自動取得、実モデルや機械的な停止の実証とは区別してください。

## 実験用hostのAPI

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
