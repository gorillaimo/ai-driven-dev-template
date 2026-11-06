# 統合検証の見本

`v1/` のprofile/request/plan/resultは合成例です。実行済み・人間承認済みの証拠には使えません。image/digest/数値IDも見本であり、profileは期限切れにしてあります。

- profile: 利用先の検査image/command、必要な検査分類、既存execution profile参照、期限・上限を提案するための見本。
- request: main/PR heads、各Issueのplan digest、依存、bundle digestを指定。
- plan: `planIntegration` が生成する、検査する集合と順序。権限を持たない。
- result: 未実行の例。実行時の結果はcontrollerが保護領域へ保存し、実際に保存した証拠の参照を付ける。

JSON/YAMLの保存だけで実行・公開の許可は得られません。host側でP3/P4のopaque handle、profileの承認元、隔離adapter、保存先を設定します。factoryや権限portをworkerに公開しません。

人間はGitHubの要約を入口に確認し、必要な場合に保護記録を参照します。詳しくは[利用案内](../../../docs/common/workflow-tools-guide.md#integration-verification)を参照してください。
