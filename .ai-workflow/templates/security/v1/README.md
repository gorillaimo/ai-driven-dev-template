# 検証・セキュリティ検査の導入例

AIがアプリの構成・リスク・既存テストを調べ、必要な検査を提案します。人間は対象・外部通信・実行環境・上限を承認し、日常はGitHubのChecks/Issue/PRで結果を確認します。必要時に保護したYAML/JSON・ログを参照します。

このdirectoryは**合成記入例**です。コピーだけで実行権限や安全性の証明は生じません。このrepository用の採用設定は[security](../../../security/)に分けています。

## 何を使うか

| 目的 | 記入例・実装 |
| --- | --- |
| APIの最小例 | profile.yaml / execution-profile.yaml / context.yaml。Gitleaks 1検査だけの合成例 |
| Web/TypeScriptの静的解析 | web-typescript.yaml。ASVS 5.0.0の8.2.1/8.2.2とACの対応例 |
| Pythonの静的解析 | python-service.yaml |
| Flutter/Dartの適用判断 | flutter-dart.yaml。初期のSemgrep規則はDart未対応として保留 |
| IaC | infrastructure.yaml。対象の形式・pathを実構成へ置換 |
| 隔離した動的検査 | dynamic.yaml。提案段階で、実hostへのadapterは未提供 |
| LLM機能を持つアプリ | llm.yaml。必要なときだけ追加。実LLMへの送信は行わない |
| 認可・他tenant等の負のテスト | access-boundary-example.mjsと専用テスト。教材の成功で実アプリの境界を確認したとは扱わない |

目的別のYAMLは個別検査の例です。アプリ全体の検査計画にはsecret/依存/静的解析、実アプリのtest/build/type-check、必要な権限・データ・IaC等の検査を組み合わせます。AIが既存CIに合わせてP1 execution profile・context・承認参照を揃えます。未確定事項は明示し、設計書に会話経緯を転載しません。

## 実行に必要な環境

管理libraryはNode.js 22以上です。実scannerの初期対応はLinux amd64、Python 3.10以上（取得処理）、管理できるDocker daemonです。利用先アプリの開発言語を限定する条件ではありません。非対応環境で隔離・上限を外して実行しません。

repository rootから、workflow-rules / workflow-execution / workflow-securityの順にlockfileで依存を導入します。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-execution --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-security --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-security
```

このtestはオフラインのfake/合成検査です。実scannerの取得・起動は別手順です。

```sh
# 新しい、存在しない保存先を指定。公開配布物とnpm ecosystemのDBだけを取得する。
python3 tools/workflow-security/acquire.py /tmp/security-tools npm
# tools.lock.jsonの固定imageを取得。可変tagは使わない。
docker pull --platform=linux/amd64 semgrep/semgrep@sha256:fb59331f2772da4a9960692ae31961cd58a7c666c014125e9202c96bdfdc38cc
# 明示した実Issue番号・実commit、採用したprofile、専用出力先で検査する。
node tools/workflow-security/cli.mjs --head <40桁commit> --issue <実Issue番号> --tool-root /tmp/security-tools --output /tmp/security-results
```

CLIは指定commitのblobからsnapshotを作ります。export-ignore、未commitの変更、repository内のignore/configを検査範囲の承認へ読み替えません。symlink/submodule・未取得object・不正path・範囲超過は停止します。partial cloneの暗黙の追加fetchも行いません。

出力先はrepository外の新しいdirectoryを指定します。raw出力は`<output>/<operation_id>/raw.json`、正規化したresults/context/plan/report/P1 verificationsはその親directoryへ保存します。外部snapshotの権限を記載だけで確認済みにしません。取得先が環境ポリシーで拒否される場合、proxyやTLS確認を回避せず、未評価を残します。

## APIと契約

- `planSecurityChecks({profile,executionProfile,context,catalog})`: 純粋な適用判定。必須/任意/非該当/未知と具体的な対象一覧を返します。
- `runSecurityCheck({plan,checkId,workspace,outputDir},executor)`: 固定adapterだけを実行します。実行には信頼するcontrollerの`createDockerExecutor`を渡します。通信・実行権限を発行するAPIではありません。
- `normalizeScanResult({toolId,rawResult,receipt,context})`: raw JSONを正規化し、secret/コード断片/原文messageを転載しません。
- `checkSecurityEvidence({profile,executionProfile,context,catalog,plan,results,previous})`: 対象・鮮度・指摘・例外・履歴を純粋に検査します。
- `loadSecurityInputs(root,paths)`: profile/executionProfile/contextを明示pathから読みます。参照の探索・URL取得・実行・更新は行いません。
- `runApplicationVerification(input,executor)`: 既存アプリCIの承認済み実行環境を明示して、test/build/type-checkのreceiptをP1 verificationへ接続します。host上でアプリを実行するexecutorを暗黙には提供しません。

schemaはsecurity/v1のcommon/profile/context/plan/result/reportの6種類です。P1 execution/v1の受理集合は変更しません。DBを使わないscannerに架空のDB時刻を記入せず、共通のP1 verificationとsecurity固有の結果を結び付けます。P1だけのpassでsecurity固有の検査が済んだとは扱いません。

`context.purpose: tool_trial`の合成DBは、repository_checkへ流用できません。OSVのLOCAL依存は公開registryの脆弱性照合と区別します。ローカル依存のコードは静的解析・アプリ実テスト等で確認します。

## 失敗・修正・例外

passed/failed/not_evaluated/errorを区別します。未起動、0対象、形式不正、scanner故障、期限切れDB/例外、scope/commit/改訂/digest不一致は成功にしません。初期profileでは検出事項を人間に提示し、Critical/High・secret・必須AC/権限境界違反を停止対象から外せません。

古い結果と既存問題を保持し、最新の失敗を古いpassで隠しません。previousや同じbatchの指摘が新結果から消えた場合も、現在の検証に束縛した別contextのP1 reviewと元指摘digestのrechecksがない限り、解決済みにしません。実装者の自己申告や検査基準の緩和で解除しません。

人間の例外は承認者・理由・finding/対象head・承認参照・期限が必要です。human_reviewとして扱い、元のfailedをpassedへ変更しません。誤検出、対応範囲外の既存問題、仕様/API/主要依存の変更が必要な場合は、根拠を残して人間へ戻します。

## 上限と保証範囲

1scanner 5分、検査全体15分、同時上限2（初期CLIは直列実行）、worker CPU2/2GiB/PID256です。raw出力10MiB、構造化入力5MiB・深さ32/200000node、証拠128・指摘1000・診断1000、公開要約1MiB。DBはecosystem最大3、圧縮合計1GiB/展開合計2GiB/100000entryで、空/破損/未対応形式を拒否します。各制限の最大値を同時に収められる保証ではありません。

workerはnetwork:none・非root・read-only・cap-drop・権限昇格禁止で、GitHub token/Docker socketを渡しません。containerの作成結果・終了/削除を読み戻し、停止不明なら次を開始しません。controller自体とDocker daemonは信頼する管理環境が必要です。任意のAgent Runnerの完全な隔離・本人性・予算強制・意味上の安全性の保証は未提供です。

設計書には現在の仕様・制約・判断理由、Issue/PRには指示/承認/作業経緯、詳細記録には対象・実結果・未評価を残します。GitHubには安全な要約を載せ、危険な詳細は承認した保護保存先を使います。

Trivyの実adapterは現在IaC/Dockerfileの設定検査です。imageのOS/package脆弱性、実hostの動的検査、実LLMの安全性は未提供・未評価として残します。image用DB/providerや実対象を採用する際は対応する契約・adapterの実装と能力試験が必要です。
