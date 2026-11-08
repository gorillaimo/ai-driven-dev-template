# Runnerの準備と確認

日常の依頼方法は[運用マニュアル](operations-manual.md)、実装の契約は[設計](agent-runner-design.md)を参照する。この資料は導入担当者・AI向けであり、人間が各Issueで繰り返す操作一覧ではない。

**現在は実サービス接続の前段階。** 通常の手動運用はそのまま利用できる。Runnerのproduction起動は、書込み領域のquota検証・実provider試行・採用承認が揃うまで拒否する。GitHub Appを毎回インストールする必要はなく、既存のGitHub仲介を採用する場合の環境設定とは別の準備である。

[実験実装のIssue #50](https://github.com/gorillaimo/ai-driven-dev-template/issues/50)のレビュー・マージには、GitHubのLinux環境で行うCIと共通仕様を確認する。この確認だけのために、利用者がMacへ仮想環境を新設したり、APIキーを登録したりする必要はない。
実運用前の残実装・検証・採用判定は[Issue #66](https://github.com/gorillaimo/ai-driven-dev-template/issues/66)で扱う。実運用が必要になった時点で環境と方法を選び、個別に承認する。

## 課金なしで確認する

以下は、Linux検証環境を持つ開発者が試験を再実行するための任意手順である。

Linux / Node.js 22以上 / Python 3.11以上 / SQLite 3.35以上を用意し、repositoryのrootで実行する。Docker境界試験のホストUIDは固定workerと同じ1000を使い、保存領域とsocketを0700/0600のまま共有する。GitHub Actionsでは一時コピーをこのUIDへ渡して実行し、checkoutや保存先を誰でも読み書きできる権限に変更しない。Node.jsは開発管理用であり、アプリの言語をNode.jsに限定しない。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-execution --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-github --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-dispatch --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-runner --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-runner
node tools/workflow-runner/cli.mjs check-profile --input .ai-workflow/templates/runner/v1/profile.yaml --at 2026-11-06T00:00:00Z --json
```

最後のコマンドは固定日時の合成profileの検査であり、workerもproviderも起動しない。費用枠は0。例のrepository・owner・署名・時刻を、実際の権限として使わない。

実Docker/固定CLIの境界試験は、[Workflow Validation](../../.github/workflows/workflow-validation.yml)の`runner_boundary` jobで行う。build手順を同じlock・同じworkerで実行し、生成した`sha256:...` image IDを指定する。

```sh
WORKFLOW_RUNNER_TEST_IMAGE=sha256:<実際のimage-ID> node --test --test-reporter=tap tests/workflow-runner/boundary.mjs
```

試験は公開archiveをhash確認してimageをbuildし、provider credentialを使わず、固定した模擬Responsesを返す。filesystem/network/credential/cgroup、子プロセス停止、CLIのJSONL/usage/session再接続、実Nodeテスト、P4→Runner→P1の接続を確認する。**実AIによるコード変更・レビュー品質・実料金の試験とは分ける。** Docker socketへのアクセスは、信頼する専用の開発ホストだけに与える。

## 実サービス試行の前に確定する

この節は#66で実運用前検証に着手する際の手順である。実験実装のマージ時に行う準備には含めない。

AI・導入担当者が、対象Issue、実行hostとquota、snapshot・送信範囲、署名発行者、model、最新単価、回数/時間/費用、保存先、停止方法を具体的なmanifestにまとめる。人間はそのmanifestの対象と上限を承認する。承認やcredentialが不足している間は接続しない。

1. 専用の検証repositoryと小さな独立Issueを1件、次に2件用意する。人間owner、個別設計承認、ready-for-ai、P4 claim/branchを確認する。
2. ホストでquota付きの書込み領域とCLI session領域を用意し、実際の上限超過試験、停止・成果保存・復旧を確認する。成果の収集上限で代用しない。
3. providerの現在のmodel提供、Responses/CLI互換性、契約・送信/保存条件、単価を公式資料と利用アカウントで確認する。ChatGPT利用権をAPI利用枠と同一視しない。
4. provider credentialとEd25519署名鍵をホストの秘密管理に登録する。鍵・tokenをチャット、Issue、コード、worker環境へ渡さない。GitHub Appの鍵とprovider credential、Runner署名鍵はそれぞれ別物である。
5. profileのdigestを確定し、固定endpointへのホスト通信を設定する。workerはnetwork noneのままとする。実行記録はrepository外のowner専用0700領域、ファイルは0600へ保存する。
6. 能力試験→単一Issue→2Issueの順に進め、成功・失敗・停止・件数・実費・未評価をIssueへ要約する。無人の継続実行はその後の別判断とする。

未解消の条件は`adapters.lock.json`のproduction採用を変更する理由にならない。試行を通過してから、確認したimage・CLI・host構成の組を採用対象にする。

## ホスト接続API

これらは信頼するホストサービス向けのAPIであり、worker JSONから組み立てない。保存先、鍵、provider接続を自動発見しない。

| 接続 | 役割 |
| :--- | :--- |
| `createGitHubRequestReader` / `createGitHubRequestIssuer` | GitHub原文・現在権限の読戻し、短い依頼とrun/profileの署名付き対応 |
| `createRunnerAuthority` | 許可した公開鍵・issuer、有効期限、現在の依頼元の照合 |
| `createProviderTransport` / `createGateway` | ホスト限定credential、固定endpoint、送信前予約、確定usageとresponse receipt |
| `createDockerAdapter` | 固定imageで能力試験・起動・観測・停止・明示session再接続 |
| `openSupervisor` | P4のcurrent handle、prepareTask/evaluate/publishTask、台帳・証拠の対応 |
| `serveControl` | owner専用Unix socket。署名付き依頼を受理し、実行中は受付結果を返す |

`prepareTask`は承認済みsnapshotとpromptを用意する。検証時はP1 profileとcommand_idを渡す。レビュー時は、実装context、検証の実記録、対象subject、P1 review JSONの形式を渡す。workerが読める内容はすべてsend_pathsの対象に含める。

`evaluate`はP1入力を構成するだけで、`passed: true`という申告では成功にできない。保存したverification出力とreview JSONをcheckerで照合する。`publishTask`は必ず既存のGitHub仲介を使い、branch・claimのhead更新を確認する。snapshotの変更だけで新headの証拠を作らない。

モデル仲介のledger/observeAttemptは`supervisor.modelPorts()`に接続する。起動時の依存を解消するためのホスト側closureはよいが、workerから差し替えられるcallbackや任意URLは使わない。`serveControl`のtask resolverは取得済みhandleの検索だけを行い、候補選択・新規claim取得・公開操作を含めない。

`accept(..., {wait:false})`は認証・受理後に`running`を返す。実行結果は状況確認で読む。制御応答そのものと、保存した`runner-result` artifactは区別する。`runner-result`はschema準拠の結果記録で、詳細なprompt・raw logを含めない。

## 停止・復旧・手動への切替

状況確認で、run、claim/worker/generation、attempt、未知usage、未反映成果、診断を確認する。停止依頼は新しい署名付き原文を読み戻して受理し、子プロセスを含む停止を確認する。`unknown`は停止済みを意味しない。

ホスト再起動後は、先にP4側の必要な復旧を済ませ、現在のhandleを用意する。Supervisorの`reconcile(tasks)`で前attemptの停止と成果を照合する。照合だけでworkerは開始しない。新しい認証済み継続依頼を受けて再開する。古いeventの再送には保存結果を返すか、受理済みとして保留する。

前のcontainer ID、保存workspace、provider usageのいずれかが確認できなければ自動再開しない。未知usageはproviderの実記録と照合する手順が必要であり、現段階では自動精算による解除を提供しない。台帳削除、旧workerの再割当、同じ呼出しの盲目的な再送は行わない。

手動へ戻す場合も、元のbranch・claim・成果・台帳を保持し、確認できた状態と未確認事項をIssueへ要約する。Runnerを使わない従来の開発手順は継続できる。

## 継続制御の実験を確認する場合

次のIssueへの自動選択・停止/再開・報告は[合成host library](../../tools/workflow-continuation/README.md)で試験できます。会話から実モデルを継続起動する接続は未提供です。通常の依頼手順は変わらず、Runnerの実運用前検証と採用承認、無人実行の有効化は別途必要です。
