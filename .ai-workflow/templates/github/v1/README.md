# github/v1

このdirectoryの6 YAMLは形式を示す合成例です。`common.schema.json`は共通型だけで、対応する成果物はありません。例の署名・本人・repository・操作結果を実行の根拠に使わないでください。秘密鍵/tokenは含みません。`session-request.yaml`の署名は無効な固定値です。

| 成果物 | 内容 |
| --- | --- |
| policy | repo/owner/delegateの数値ID、P1 profile、許可操作/path/branch、期限、上限、旧記録対応表 |
| snapshot | 観測区間、全量/部分/取得不能、page、各resourceの識別/digest、権限・保護の不足 |
| session-request | trusted issuerの署名payload。event/session/nonce、人間actor、repo/owner/run、policy/profile digest、intent、期限 |
| authorization | 照合結果・digest・期限・未評価。保存可能な記録で、brokerのcapabilityではない |
| operation | 有限の操作payloadとrepo/Issue/run/claim/worker/generation/branch/head/digest |
| receipt | 送信前、送信中、確認済み、不明、失敗。期待する読戻し・要求数・部分成功・診断コード |

namespaceは`urn:ai-workflow:github:v1:*`、Draft 2020-12。未知key/version、重複identity、非JSON入力、循環や過大入力を拒否します。旧execution/v1、Issue/Project v1、手動Markdown v1の意味は変更しません。

## ローカルで確認する

repository root、Node.js 22以上（HTTP helperのテストにはPython 3.10以上とGit）で実行します。

```bash
npm ci --prefix tools/workflow-github --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-github
node tools/workflow-github/cli.mjs validate --kind policy --input .ai-workflow/templates/github/v1/policy.yaml
```

依存導入後の`npm test`は偽APIと一時journalだけを使い、GitHubへの通信/書込み、実credential、AI呼出しを使いません。`validate`も形式確認だけです。

公開repoを読み取る場合、AIが採用した実policyと取得scope（`approval_sources`, `actors`, `include_protections`）を1 fileに用意してから明示実行します。

```bash
node tools/workflow-github/cli.mjs collect --input /private/controller/collect.yaml --output /private/controller/new-observation
```

outputは事前に作るmode0700・repo外directoryです。新しい`snapshot.json`を0600で作り、既存fileへ上書きしません。CLIの入力は通常file 1 MiB以内、出力は1 MiB以内。duplicate key、alias、symlink、未知引数を拒否し、要約には件数と状態だけを出します。取得未完/権限不足があれば終了コード2です。標準transportは無認証GET専用で、非公開repoへ接続するcredentialを探索しません。

## controller API

| API | 分担 |
| --- | --- |
| `collectGitHubSnapshot({policy,scope}, transport, clock)` | GET専用の全量取得と不足の記録 |
| `createAuthorityProvider({mode,keys,clock,journal,observe})` | workerから独立した信頼設定。observeはsnapshot/execution/credentialと今回使用した`api_requests`を返す |
| `verifyRunAuthorization(input, provider)` | policy/profile/grant/snapshot/request/approvalProofsを照合し、記録・opaque capability・P1 factsを返す |
| `createFileJournal({directory,sourceRoot,limits})` | repo外の単一controller用lock/hash chain/fsync。終了時にclose |
| `executeBrokerOperation(operation, capability, context)` | 許可操作だけを実行し、永続化したreceiptを返す |
| `reconcileBrokerOperation(id, capability, context)` | 応答不明の実状態照合。非冪等POSTは再送しない |
| `projectReceipt(receipt, capability, context)` | 実journalと現在の権限を照合してP1 eventへ投影。権限発行はしない |
| `createGitHubAppTokenProvider(config)` | 明示的に有効化したApp tokenのissue/revoke。秘密はopaque sessionに保持 |
| `createRestTransport(config)` | 固定GitHub.com REST/Python HTTP。read_onlyか、opaque App sessionを受けるbroker |
| `runLimitedTrial(config)` | 承認済み専用repoを対象に5操作を上限内で試行。通常CIからは呼ばない |

`context`はcontrollerが保持する`{transport,journal,authorityProvider}`です。workerはoperationのJSONしか渡しません。callbackの実装、issuerの人間操作保証、worker隔離・予約・保護された保存先の導入は[接続準備](../../../../docs/common/github-boundary-setup.md)を参照してください。

署名対象はUTF-8の`workflow-github:v1:<artifact_kind>\n`と、`{issuer,key_id,payload}`のcanonical JSONです。`artifact_kind`は`session-request`または`approval-proof`。Ed25519署名を標準base64で格納します。署名秘密鍵は外部issuerが管理します。

## 初期上限

| 対象 | 上限 |
| --- | --- |
| 収集 | 60秒、全API 400回、同時取得は現在1本（許容最大4）、1要求10秒 |
| pagination | 100件/page、Issue/PR/branch各1000、コメント/review合計10000 |
| retry | GETのみ1回、Retry-After 0〜5秒が枠内に収まる場合。POSTの一般再試行なし |
| サイズ | 応答2 MiB、応答総量64 MiB、API入力5 MiB・深さ32・20万node、出力1 MiB・診断1000 |
| 鮮度 | snapshot 60秒、依頼初回受理5分。停止確認は各mutation前、観測callbackは10秒以内 |
| broker | 180秒・100 API回（観測callbackの報告数を含む）、32 files・各1 MiB・変更計5 MiB |
| journal | 10000遷移・32 MiB。保管先/lock不明、破損、未解消操作で停止 |
| 限定実証 | 15分・100 API回・1 repo/Issue/branch/file/commit/Draft PR、comments最大2、file最大1 KiB |

変更可能pathと禁止path、main保護、期限、予約、停止を全mutation前に照合します。callbackが実API数を報告できない場合は許可しません。P4の原子的な複数Issue予約やP5の認証済み会話接続は、このpackageを導入するだけでは提供されません。

応答不明のreceiptが残った場合は[復旧手順](../../../../docs/common/github-boundary-setup.md#操作と復旧)を確認し、手動v1へ無断で記録を転用せず、実状態の照合を先に行ってください。

`observe`にはadmission/operation/mutation等のphaseを渡します。brokerは全mutation前に必ずmutation phaseで再照合します。`verifyRunAuthorization`が返す`execution`は現在の束縛を示す情報で、変更してもcapabilityの権限は変わりません。App providerの`revocationState()`は安全な失効状態だけを返し、token発行応答の喪失もunknownとして扱います。このrepoで採用する手動controllerは[Actionsの起動手順](../../../../docs/common/github-trial-actions.md)を参照してください。
