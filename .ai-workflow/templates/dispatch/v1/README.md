# Dispatcher契約v1の合成例

このv1はDispatcher入出力の版であり、Project設定はv2を参照する。実承認、実行結果、稼働台帳ではない。

- `request.yaml`: 設定・profile/grant・snapshot・Issue/制約観測・台帳を束ねた候補選択入力。
- `batch-plan.yaml`: 権限を持たない候補・保留理由。
- `migration.yaml`: 移行元/先・全量観測と個別処置を束縛するmanifest。
- `migration-input.yaml`: 元v1設定・先v2設定・snapshot・既存claimを含むpreview用の完全入力。
- `ledger-view.yaml`: controllerが出力する台帳view。原本DBの代わりに書き戻さない。
- `transition.yaml`: workerの状態変更要求。要求だけで停止・解除が承認されたとは扱わない。

例の時刻は固定されている。CLIやpure APIへ渡す検査は実行権限を付与しない。現実のsnapshot、承認、署名、保存先、worker停止は信頼するホストadapterで別途検証する。[設計](../../../../docs/common/dispatcher-design.md)と[導入・復旧](../../../../docs/common/dispatcher-setup.md)を参照する。
