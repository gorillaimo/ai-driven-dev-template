# 継続制御の合成例（continuation/v1）

この5ファイルは形式の記入例です。認証、承認、実行権限、実GitHub操作を与えません。日時は固定した合成時刻で、profile/requestは期限切れです。

| ファイル | 用途 |
| --- | --- |
| profile.yaml | 対象repo/人間owner、方針・各profileのdigest、合計上限 |
| request.yaml | 継続/状況確認/停止/対象制限の依頼とsource/event/nonce |
| decision.yaml | 全量入力をP4へ渡して得た候補。authorityはfalse |
| checkpoint.yaml | 保護領域のjournal内状態の例。実行権限の代替にはしない |
| report.yaml | 人間向け要約の元データ。生ログや環境変数を含めない |

controllerが生成するcheckpoint/reportを人間が手編集して再開しないでください。例のcheckpointは認証を認めない合成hostで取得した状態です。副作用は始まっていません。参照先は同梱していない合成記録です。

共通仕様は[自律開発設計の10.1節](../../../../docs/common/autonomous-development-design.md#101-継続制御の実験実装continuationv1)、API/host portは[ツールREADME](../../../../tools/workflow-continuation/README.md)を参照してください。
