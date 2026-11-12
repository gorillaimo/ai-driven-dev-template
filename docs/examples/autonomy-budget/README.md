# 上限判定ツールを試す

AIが次の作業を始める前に、件数・時間・残量からどんな助言を得るかを、合成データで確認する例です。
通常の会話開発では、この関数の利用は任意です。[会話での進め方](../../common/development-rules.md#continuation-procedure)も参照してください。

## 1. 同じ版のコードと依存を準備する

この文書・コード・schema・設定・lockfileを含む**完全な同じcommitのcheckout**を使います。READMEだけをコピーしても動きません。
Node.js 22以上を用意し、以下をリポジトリのルートで実行します。Node.jsは開発管理用で、作るアプリの言語は問いません。

```sh
node --version
git rev-parse HEAD
for package in workflow-rules workflow-check workflow-trace workflow-schema \
  workflow-golden workflow-ci workflow-project workflow-execution workflow-security \
  workflow-github workflow-dispatch workflow-runner workflow-integration workflow-continuation
do
  npm ci --prefix "tools/$package" --ignore-scripts --no-audit --no-fund || exit 1
done
npm run check:autonomy --prefix tools/workflow-schema
```

依存の初回取得には通信が必要です。最後のコマンドは保存された[設定ファイル](../../../.ai-workflow/autonomy.yaml)の形式・範囲・大小関係を検査し、書き換えません。
失敗した場合は設定・取得障害を解消してから先へ進みます。検査の詳細は[設定の検査手順](../../common/workflow-tools-guide.md#autonomy-settings)を参照してください。
この例は設定の初期値（総2 Issue・60分・並列1・修正2巡・残量30%/15%）を前提とします。変更済みの設定では、次の初期値照合が失敗するので、期待値も自分の承認済み設定に合わせて見直します。

## 2. 保存設定と合成の作業状況を渡す

次のコードもリポジトリのルートで実行します。保存設定を読む処理はこの例の呼出し元が行います。
`decideContinuationBudget`自体には設定loaderも、今回だけの指定との合成機能もありません。
日付・Issue番号・観測対象名・残量はすべて説明用で、実際の契約利用枠には接続しません。

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { decideContinuationBudget } from './tools/workflow-continuation/controller.mjs';

const require = createRequire(new URL('./tools/workflow-schema/package.json', import.meta.url));
const { parseDocument } = require('yaml');
const file = '.ai-workflow/autonomy.yaml';
const before = readFileSync(file, 'utf8');
const document = parseDocument(before, { uniqueKeys: true });
assert.equal(document.errors.length, 0);
const policy = document.toJS({ maxAliasCount: 0 });
assert.deepEqual(policy, {
  schema_version: 1, artifact_kind: 'autonomy-settings', revision: 1,
  limits: { issues: 2, minutes: 60, parallel_issues: 1, repair_rounds: 2 },
  quota: { stop_new_remaining_percent: 30, checkpoint_remaining_percent: 15 },
});

const now = '2030-01-01T00:10:00Z';
const run = {
  started_at: '2030-01-01T00:00:00Z', last_checked_at: now,
  issues: [{ number: 1, repair_rounds: 0 }], active_issues: [], active_agents: 1,
  stop_requested: false, authorization_lost: false, storage_failed: false, work_unknown: false,
};
const unsupported = { status: 'unsupported' };
const available = (remaining) => ({
  status: 'available', retry_count: 0, observed_at: now,
  expected_scope: { account_ref: 'example-account', workspace_ref: 'example-workspace', window_ids: ['example-window'] },
  observed_scope: { account_ref: 'example-account', workspace_ref: 'example-workspace' },
  windows: [{ id: 'example-window', metric: 'remaining_percent', value: remaining }],
  warning: false, exhausted: false,
});
const cases = [
  ['非対応', unsupported, run, now, 'continue', null, null],
  ['総2件', unsupported, { ...run, issues: [...run.issues, { number: 2, repair_rounds: 0 }] }, now, 'stop_new', 'budget_issue_limit', null],
  ['50分', unsupported, run, '2030-01-01T00:50:00Z', 'stop_new', 'budget_save_window', null],
  ['60分', unsupported, run, '2030-01-01T01:00:00Z', 'checkpoint', 'budget_deadline', null],
  ['合成30%', available(30), run, now, 'stop_new', 'budget_quota_low', 30],
  ['合成15%', available(15), run, now, 'checkpoint', 'budget_quota_critical', 15],
  ['観測不明・再確認前', { status: 'unavailable', retry_count: 0 }, run, now, 'stop_new', 'budget_quota_unknown', null],
  ['観測不明・再確認後', { status: 'unavailable', retry_count: 1 }, run, now, 'checkpoint', 'budget_quota_unknown', null],
];

for (const [label, observation, snapshot, at, decision, reason, remaining] of cases) {
  const input = { policy, observation, run: snapshot, now: at };
  const saved = structuredClone(input);
  const result = decideContinuationBudget(input);
  assert.equal(result.authority, false);
  assert.equal(result.decision, decision);
  assert.equal(result.remaining_percent, remaining);
  if (reason) assert.ok(result.reason_codes.includes(reason));
  if (decision !== 'continue') assert.equal(result.can_start_issue, false);
  assert.deepEqual(input, saved);
  console.log(label, result.decision, result.remaining_percent, result.reason_codes.join(','));
}
assert.equal(readFileSync(file, 'utf8'), before);
console.log('8例の期待値・入力/設定の非変更を確認');
JS
```

## 3. 結果を読む

| 例 | 期待する助言 | 意味 |
| --- | --- | --- |
| 最初から残量取得が非対応 | `continue`、残量`null` | 件数と時間の範囲で判断。残量が十分という意味ではない |
| 総着手2件 | `stop_new`、`budget_issue_limit` | 3件目の新規Issueを始めない。保留・失敗したIssueも総数に含める |
| 開始から50分 | `stop_new`、`budget_save_window` | 最後の10分に入り、新規Issue・agent・修正巡回を始めず保存・報告へ進む |
| 開始から60分 | `checkpoint`、`budget_deadline` | 期限に達したため保存優先 |
| 合成残量30% / 15% | `stop_new` / `checkpoint` | 30%以下は新規停止、15%以下は保存優先。実残量の計測ではない |
| 取得が故障し再確認前 / 再確認後も不明 | `stop_new` / `checkpoint`、`budget_quota_unknown` | 呼出し元が1回まで再確認し、回復しなければ保存停止。非対応に読み替えない |

複数の理由に該当すれば`reason_codes`に併記されます。操作別の`can_start_issue`・`can_start_agent`、修正可能/保留Issueも確認できます。
戻り値の項目・入力条件は[APIの説明](../../../tools/workflow-continuation/README.md#budget)を参照してください。

**この実行で確認できるのは、注入した値に対する判定と非変更だけです。** 関数は同期の純粋関数であり、実際の時計・残量を取得せず、AIを起動・停止したり、途中保存したりしません。module import時には既存依存と同梱schemaを読みます。
`authority: false`や`continue`を実行許可と扱わず、AIは担当・承認・依存・競合・必要な検査/独立レビューを別に確認し、実際の保存と報告を行います。
利用枠の自動取得・強制停止・制限回避や全環境での完遂を、この例の成功で保証することはできません。
