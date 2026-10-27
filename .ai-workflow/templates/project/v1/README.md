# Project schema v1 記入例

このdirectoryのproject.yaml、delivery-plan.yaml、team.yamlは合成サンプルです。
実際の担当・権限・承認・実行中状態ではありません。初期形式はIssues-only / manualです。

利用時は人間が採用を決め、必要な3ファイルを`.ai-workflow/project/`へ明示コピーします。
project_id、repository、template_origin、login、source_ref、Issue、時刻、area、方針値を実案件へ置換してください。
公開元には利用先の実設定を作りません。Project採用を必要としない単一Issue運用も継続できます。

| ファイル | 正本として保存する内容 | 保存しないもの |
| :--- | :--- | :--- |
| project.yaml | 管理担当の設定、共有area、membership/status/claim/syncの静的方針、template由来 | active claim一覧、GitHub runtime状態、実checkpoint |
| delivery-plan.yaml | featureの参照、依存理由、計画priority、制約、関連Issue、計画改訂記録 | 要件本文、実行時status/assignee/priority、計算済みwave |
| team.yaml | 人間login、role、担当可能area、active、同時担当上限、統合責任area | token、メール、端末ID、勤務情報、実権限の証明 |

全成果物にschema_version:1、artifact_kind、project_id、revision、updated_at、updated_byが必要です。
filenameがdelivery-plan.yamlの場合、artifact_kindはdelivery_planです。Projectのproject_idは小文字英数字とhyphenを使います。
feature/area ID、actor、日時、login、参照、approvalはIssueの共通定義を再利用します。AI/bot記録者は人間のon_behalf_ofが必要です。
coreの未知fieldは拒否し、独自メモはtop-level extensionsへ置きます。extensionsは承認や機能有効化の根拠ではありません。

project.yamlの注意:

- runtime_backendはissues、coordination_modeはmanualのみ。Projects/Dispatcherはこのversionでは受理しません。
- template_originのversionはtemplate本体のSemVer、commitは40桁、repositoryはcredential/queryなしのHTTPS repository URLです。例のゼロcommitは必ず置換します。
- project全体のcoordinatorは1人でarea_ids空。area別なら各assignmentのarea_idsを1件以上指定します。重なりやrole/member一致は後続validatorで確認します。
- membership_sourceはtype:repository。Organization Team未採用ならorganization_team:nullまたは省略で構いません。
- required_repository_permissionは方針値で、実権限は別途確認します。status_mappingの8値はready-for-aiと別で、ラベルを作成する命令ではありません。
- claim_policyの秒数は正整数の合成設定です。例の4時間heartbeat/24時間staleを実案件で合意し直します。staleは警告、解放は人間が行い、自動stealしません。
- shared:trueのareaにはintegration_ownerが必要です。pathsは相対path/prefixで、globは初期非対応です。実際のpath存在やscopeの重なりは形式検査しません。
- sync_policyはgithub_to_snapshot / event_id / manual_reviewの方針だけを記録し、同期処理を起動しません。

delivery-plan.yamlの注意:

- source_refはdocs/system-context.mdと明示fragment。利用先の文書にfeatureの目的・要件・ACを書き、台帳へ本文を複製しません。
- depends_onはfeature_idとreasonのobject配列です。未作成Issueはissue_refs空配列にし、架空の番号を採番しません。
- planned_priorityは正整数で小さいほど先。同順位の実行順は後続の計画・候補検査で決めます。
- constraintsのkindはapproval/external_dependency/shared_area。referenceとreasonが必要で、shared_areaだけはarea_idも必須です。
- revision_historyはrevision/reason/approval/affected_feature_ids/invalidated_wavesを記録します。初回は空で構いません。
- approvalの参照や改訂記録を書くだけで本人性・追記性・改訂の連続性が証明されるわけではありません。

team.yamlのrolesはcoordinator/developer/reviewerです。1人が複数roleを持てます。max_concurrent_issuesは整数1以上です。
active:falseは新規割当を止める設定であり、実claimの引き継ぎは後続の運用で扱います。
空のfeature/member/area一覧は書き始めの形式として受理できますが、割当可能・計画完成を意味しません。

## 形式テストと限界

repository rootで実行します。初回の依存取得にはネットワークが必要です。

```sh
npm ci --prefix tools/workflow-schema --ignore-scripts --no-audit --no-fund
npm run test:project --prefix tools/workflow-schema
```

このコマンドは同梱のschema・記入例・fixtureを検査する専用テストです。
コピーした利用先の`.ai-workflow/project/*.yaml`を自動走査するコマンドではありません。
schemaに適合しても、IDの一意性、循環、参照先の存在、member/areaの照合、権限、capacity、承認、割当、着手・完了は保証しません。
必要な意味検査は後続validatorへ分離します。現在のCI runnerがProject領域を対象外にしていることも変わりません。

YAMLが正本で、delivery-plan.mdは将来の生成表示です。今回は生成器や共有Project state.yamlを作りません。
非対応versionや破損では元データを保存して人間レビューへ戻します。自動修正・変換・権限確認・GitHub操作を行いません。
契約と移行方針は`docs/common/project-orchestration-design.md`、`versioning-policy.md`、`migration-v1-to-v2.md`を参照してください。
