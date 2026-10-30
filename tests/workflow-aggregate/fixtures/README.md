# Project集約の合成入力

`project.json`、`deliveryPlan.json`、`context.json`は確認snapshot、`workflow-*.json`は既存Issue checkerを再実行するための元入力です。`paths.json`に読むファイルを明示列挙しています。
example/projectのIssue #1、example-user、時刻、ゼロcommit、承認・事実参照はすべて合成例で、実Issue・権限・承認の証拠ではありません。
contextは2026-10-30T00:00:00Zを観測/評価時刻とし、鮮度制限1時間です。評価時刻を進めれば再確認が必要になります。
managedなassigned Issue1件を既存checkWorkflowで再生します。初回eventをcheckpointに投影しますが、GitHubや元ファイルを更新しません。
ruleInputはlegacy原文とdigestを含むテスト用snapshotです。運用上の正本はAGENTS.md/development-rules.mdであり、コピーした原文を規約の代わりにしません。

実案件では人間が取得範囲・現在の事実・元のIssue成果物を確認し、実番号、ID、login、台帳revision/digest、時刻、branch/commit、根拠参照へ置換します。
人間向けMarkdownコメントは自動解析しません。contextのclaims等は確認済みGitHub記録の構造化された投影で、claimを実行する契約ではありません。
利用例と保証範囲は[運用マニュアル](../../../docs/common/operations-manual.md)、[設計](../../../docs/common/project-orchestration-design.md)第13.0節を参照してください。
