# Runner v1の合成例

Runner固有の契約の例であり、実権限・実承認・実行済みの証拠ではない。既存のexecution/GitHub/Dispatcherのschema_versionは変更しない。

- `profile.yaml`: 固定CLI候補、読み書き/送信範囲、model/料金の合成値、時間・資源・回数上限。費用枠0で実providerは呼べない。
- `request.yaml`: 署名付き依頼の形。署名は無効なダミーであり、実ホストの署名発行と現在のGitHub原文確認に置き換える。
- `capability.yaml`: 未評価の能力はfalse。全必須項目が確認できなければ起動しない。
- `result.yaml`: 起動拒否と未評価の記録。成功の見本ではない。

時刻は固定している。`check-profile --at`やschemaへの適合は、実行許可を与えない。attempt/usageはSupervisorの保護台帳から生成し、YAML例を台帳へ書き戻さない。

[設計](../../../../docs/common/agent-runner-design.md)と[準備・復旧](../../../../docs/common/agent-runner-setup.md)を参照する。
