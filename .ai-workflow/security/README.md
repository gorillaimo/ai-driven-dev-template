# このrepository用のSecurity Validation設定

profile.yaml / execution-profile.yamlは、テンプレート管理コード自身を検査する採用設定です。利用先アプリの設定や実行grantではありません。対象repo・owner・承認参照・期限を確認し、他のrepositoryへはAIが対象に合わせた採用PRを準備します。

GitHub ActionsのSecurity Validationが、固定tool/DB取得→合成入力で実toolの検出能力確認→指定commitの実code/依存検査→終了照合→安全な要約の順で実行します。PR/main/手動と週1回の再確認を別のread-only workflowで行います。既存のオフラインWorkflow Validationは独立して動きます。

現在の設定の期限は2026-12-04 06:06 UTCです。期限やtool/rules/除外/対象を更新する場合は、人間レビューを経た設定PRで変更します。時刻だけを書き換えて再承認や検証を補完しません。

CIの追跡用Issueは、この検査設定を導入した実Issue #47です。自律開発の担当/claim/工程着手を表すものではありません。将来のGitHub collectorやRunnerの権限確認を代行しません。

CIのSummaryは成否と件数・未評価を示します。raw出力はuploadせず、詳細ファイルはjob終了後の永続保存を保証しません。詳細確認は対象commitを保ち、承認済み保護保存先への保存を設定するか、[手動手順](../templates/security/v1/README.md)でローカル再検査します。取得失敗や未保存を成功・保存済みの証拠へ読み替えません。

取得stepでは`WORKFLOW_SECURITY_TIMING=1`を設定し、Pythonによるtool取得・checksum・展開/配置とDB取得・検証の時間をstderrのJSON行へ記録します。ローカルでも、既存の`acquire.py`呼出しにこの環境変数を付けた場合だけ有効です。引数・stdoutの取得結果・終了codeは変えません。設定なしや`1`以外では計測しません。

診断は`format_version: 1`、`artifact_kind: security-preparation-timing`、`stages`（固定`stage_id`、`status`、`duration_ms`）、`truncated`から成り、最大32工程/16KiBです。未計測時間は`null`、未着手工程は記録なしで、いずれも0秒や成功とみなしません。時計やstderrの故障で取得結果を変更せず、強制終了時は最終診断が残らない場合があります。Semgrep image pullとinventory作成などは計測外です。[項目の読み方・計測範囲](../../docs/common/workflow-tools-guide.md#security)を参照してください。

この診断はActionsのstepログで確認する参考情報で、security/v1の判定・承認記録ではありません。URL・path・例外本文・環境値・検査原文を含めず、新しいartifact uploadや保存処理は追加しません。cacheやDB/合否結果の再利用、検査回数・取得元/checksum・鮮度条件の変更は行いません。

required checks/branch protection/公開範囲/課金設定は変更しません。Actionsの利用枠は消費します。v2 stable Releaseを作成する設定ではありません。
