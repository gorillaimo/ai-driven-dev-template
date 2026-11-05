# Dispatcherの導入・確認・復旧

Dispatcherは管理部品として提供している。通常のIssue/PR運用や手動Coordinatorを続けるために設定する必要はない。GitHub Appの新規インストール、DBサーバー、GitHub Projects製品は、このローカル検査には不要である。

## 人間が決めること

- 利用先でDispatcherを採用するか、Coordinatorと担当人間を誰にするか。
- 専用Linuxホスト、repository外の保存先、その保護とバックアップ。
- 実行profileの範囲・予算・期限、本人確認とworker停止を検証するホストadapter。

AIは既存の担当・branch・PR・手動記録を調べ、移行案と不足を提示する。人間が毎回Issue一覧を手で選ぶ前提ではない。導入先の承認・権限・worker隔離が揃うまでは、読み取り専用検査と従来運用を使う。AI起動・隔離と会話からの連続実行は後続機構が必要である。

## AIが準備するもの

1. Project v1原本と参照commitを保存する。初導入なら元設定をnullとする。
2. `.ai-workflow/templates/project/v2/`を基に、利用先のproject/team/delivery-planを準備する。version番号だけの変更で済ませず、担当・依存・数値repository ID・全参照を確認する。
3. team/delivery-planの内容digestとrevisionをprojectへ設定する。digestは`core.mjs`の`hash`（canonical JSONのSHA-256）で計算する。ファイルの生バイトhashとは異なる。
4. 既存claim、default branch以外のbranch、PR、手動記録を全量snapshotと照合する。各項目のretain/not_claim等と人間の確認参照をmigrationへ記載する。未解消claimは保持する。
5. 下記CLIで形式・候補・移行案を確認し、GitHubのIssue/PRへ要点・停止理由・未評価を報告する。合成例のID・digest・承認参照を実承認として使わない。

## 読み取り専用CLI

Node.js 22以上と固定lockfileの依存を使う。検査は利用先アプリのテストとは別である。

```bash
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-execution --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-github --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-dispatch --ignore-scripts --no-audit --no-fund
node tools/workflow-dispatch/cli.mjs check --input configuration.yaml --json
node tools/workflow-dispatch/cli.mjs plan --input request.yaml --json
node tools/workflow-dispatch/cli.mjs migration --input migration-input.yaml --json
node tools/workflow-dispatch/cli.mjs status --input ledger-view.yaml --json
```

`configuration.yaml`は`project`/`team`/`deliveryPlan`を含むオブジェクト、`request.yaml`はdispatch request契約、`migration-input.yaml`はfrom/to/snapshot/legacy_claims/migration/evaluated_atを持つ。`status`はcontrollerが出力した台帳viewを読む。CLIはDBを開かず、予約・移行適用・credential取得・通信をしない。全コマンドで適合・readyは終了コード0、停止・未移行・復旧待ちは1。`--json`なしは簡潔な日本語表示となる。

専用テストにはLinux、Python 3.11以上、SQLite 3.35以上が必要である。

```bash
npm test --prefix tools/workflow-dispatch
```

## 実適用するホスト側の契約

`createDispatcherAuthority`へ現在の本人確認・承認とGitHub観測、移行確認、worker停止・解除、復旧確認のcallbackを登録し、不透明なauthorityを`openDispatcher`へ渡す。P3の耐久journal・transport・署名検証鍵も必要である。P4には実利用先のcallback実装やRunner起動コマンドは含まない。合成fixtureのcallbackを実環境へコピーしてはならない。

保存directoryはrepository外の専用ローカル領域0700とし、ファイルをworkerへ公開しない。controller/storeのmutation APIやtask handleを未信頼workerへ直接渡さない。JSONの`reserved: true`や`approved: true`を根拠にcallbackを成功させない。

## 停止・復旧と手動運用への切り替え

1. controllerのstopで新しい外部更新を止め、workerの終了を別途確認する。stopだけでclaimを解除しない。
2. controllerを閉じた状態でdirectory全体を権限を保ってバックアップする。稼働中にDBだけをコピーしたり、lock/journalを削除したりしない。
3. 再起動で`recovery_required`なら、旧workerと未push変更を照合する。全active claimと未解消操作の処置をCoordinatorが確認する。
4. GitHub更新はjournalと実状態を読み戻す。同じPOSTの再送や、見つからないjournalの捏造をしない。すべて確認できた場合だけcontrollerのrecoverへ明示処置を渡す。
5. 不明な操作・破損・設定変更・容量上限で止まったら、原本を保存し人間へ報告する。新しい空DBを作って二重着手を許可しない。保持中claimとbranch/PRを確認し、Dispatcherとworkerを停止したうえで手動Coordinatorへ引き継ぐ。

台帳は固定設定に束縛する。設定変更の自動移行、履歴の自動削除、別ホストへの自動failoverは提供しない。容量に達した場合も、既存予約を無視して手動で作業を始めず、専用の移行・保管判断を行う。

人間はGitHubのIssue/PRで、候補・保留理由、検証結果、未評価、次に必要な判断を確認する。YAML/JSONやSQLiteはAIと管理部品の照合用原本で、詳細調査が必要な場合に人間も参照する。移行・復旧の経緯はIssue/PRへ、採用した仕様は設計書へ分けて残す。
