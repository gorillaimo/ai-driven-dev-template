# Project v2の合成記入例

`project.yaml`、`team.yaml`、`delivery-plan.yaml`はIssues-only/dispatcherの組である。3つともschema version 2を要求し、projectがteamとdelivery-planのrevision・canonical内容digestを固定する。Project v1を上書きしない。

例は架空repository・担当・承認参照であり、実行許可ではない。実導入は[手順](../../../../docs/common/dispatcher-setup.md)と[設計](../../../../docs/common/dispatcher-design.md)を参照する。設定の変更後はdigestも計算し直す。既存のclaim・branch・PR・手動記録を確認し、明示移行するまで台帳を有効化しない。
