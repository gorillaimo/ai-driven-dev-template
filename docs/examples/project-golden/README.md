# Project Golden Testの固定例

この例は、開発管理の判定が意図せず変わらないかを検出する合成テストです。アプリの機能テストや実GitHubの同時操作ではありません。
[Project設計第16章](../../common/project-orchestration-design.md)の14観点を、既存の計画・member・集約・推薦checkerで検証します。
既存12caseに25 Project caseを加えた37caseを、同じ[Goldenハーネス](../../../tools/workflow-golden/run.mjs)で実行します。

## 読み方と実行

[運用マニュアル](../../common/operations-manual.md)のGolden Test節に従い、既存rules/check/trace/goldenに加えてworkflow-projectの依存も導入します。

```sh
npm test --prefix tools/workflow-golden
node tools/workflow-golden/run.mjs --json
```

入力・期待見本・禁止条件の正本は[fixtures](../../../tests/workflow-golden/fixtures/cases.json)です。
project_plan / project_members / project_aggregate / project_recommendは各既存APIを直接呼び、result schemaを検証します。推薦は元入力から既存checkerを再実行します。
同一caseの台帳、snapshot、member facts・全量claim・対象Issueを横断テストで照合します。

全fieldの見本比較、status/診断signals、独立した重要値assertion、禁止条件を使います。想定blocked/waitならテストはpassedです。
未選択adapterのnot_evaluated、各checkerが未評価とする実認証・実操作等を成功へ読み替えません。
すべて固定した合成ID・人間login・agent・時刻・根拠です。実作業の承認や証拠へ転用しないでください。

## 第16章との対応

| 設計の観点 | case ID（project-接頭辞を省略） | 独立して確認すること |
| :--- | :--- | :--- |
| 1人・1feature | single-feature | 4 adapterが同じ原本を使い、割当相談1件を返す |
| 依存未完了 | dependency-wait | 下流をreadyへ昇格・推薦しない。元labelは保持 |
| 循環・未知feature | dag-cycle / unknown-feature | 実計画checkerのdependency_cycle / unknown_dependency |
| 共有area | area-serialization | 同時waveを避け、wave1のIssue #10がwave2の#2より先 |
| inactive・権限・capacity | member-inactive / permission-denied / capacity-full | 役割名で実権限を補わず、自己既存+0と新規+1を区別 |
| Organization Team | team-mismatch | 台帳と確認済みTeamの不一致で停止 |
| 同じIssueへの2要求 | claim-request-a / claim-request-b / claim-owner-confirmed / double-claim | 確定前は両方とも相談のみ、人間確定後は他方を除外、二重activeは拒否 |
| stale | stale-claim | 継続確認待ち。claim数と所有を保持し、自動stealしない |
| event再読込 | events-first / events-replay | 最初のcheckpointが次入力と一致し、再読込の追加件数は0 |
| 状態不一致 | state-mismatch | GitHub確認branchと内部stateの差をworkflow_sourceで停止 |
| 手動fallback | manual-fallback-paused / manual-fallback-ready | 人間pauseで待機し、実状確認後のIssues-onlyで相談へ戻る |
| 未割当 | unassigned-no-claim | ask_coordinator・人間確認必須、実claim作成なし |
| botと人間owner | bot-owner-missing | 記録actorのon_behalf_of欠落をblock |
| Issues-only | issues-only | Projects fieldやAPIなしで動作 |
| 追加：managed再開 | managed-resume | 本人/agent/引継を照合し、自己追加0・next_stage:intakeを1つ返す |
| 追加：承認待ち | approval-wait | 既存Issueの待機を保持し、下位の未割当Issueへ移らない |
| 追加：部分取得 | partial-inventory | 部分的な取得を空きや成功と扱わない |

## 静的に確認する範囲

同時要求の前snapshotでは、複数人に同じ未割当候補が見えます。両方が相談を返すことは排他の失敗ではなく、まだclaimを確定しない境界です。
人間Coordinatorが1 owner/claimを確定した後の固定snapshotで、もう一方の人間へ作業を提案しません。二重activeの入力は拒否します。
原子的な勝者選択やライブ同時操作は実装していません。将来のDispatcherの別Issueで検証します。

Dispatcher自体も未実装です。fallbackは人間が停止を指示した記録と、実状確認後に手動運用へ戻した記録の比較です。
実Dispatcher停止の検知、GitHub/API障害復旧、実案件の未push/引継ぎを試した結果ではありません。架空のdispatcher_statusをschemaへ追加しません。
依存未完了の元labelも書き換えません。集約と推薦で危険な着手を止めることを確認します。

checkpointのevent ID/digest prefixとIssueごとの記録を保持し、同じ入力で同じ結果を返します。
再読込入力には前checkpointが加わるため、結果のsource_input_digestは今回の入力digestへ変わります。このfieldも比較対象で、無視していません。

## 見本の変更と保証境界

managed入力のruleInputは固定し、sourceDigestsに対応するAGENTS.md・development-rules.md等をcaseの登録assetとして保存します。実repositoryのalways-on規約は変更しません。
差分が出たらcase ID・code・比較path/禁止条件indexから原因を確認し、仕様変更の理由をIssue/PRでレビューしてから見本を手動更新します。自動更新optionはありません。
通信・外部command・file書込みを禁止した子process、入力/file digest、cold30秒目標でも確認します。fixtureのcommandや参照先を実行・取得しません。

file1 MiB、1case128file/5 MiB、深さ12、100case、report1 MiBと各APIの入力上限を維持します。未知・破損・欠落・比較差分・例外・上限超過は失敗です。
失敗時は元入力・見本・履歴を保存し、人間レビュー・個別checker・手動Coordinatorへ戻します。実データを修復しません。
実GitHub・本人/権限/証拠/時計/全量性、自然言語の意味、実scope/未push・引継、原子的claim、実Dispatcher障害、実作業は未評価です。
CI成功だけでReleaseを承認せず、v2のalpha/stable公開は別の判断にします。
