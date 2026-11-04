# GitHub取得・外部操作の接続準備

`tools/workflow-github/`は、GitHubの状態取得、依頼・承認の照合、許可した操作の実行と記録を担当します。P3の部品であり、会話から複数Issueを動かす常駐サービスではありません。会話の認証入口、workerの隔離、作業の予約と起動はP4/P5で別途接続します。

## 人間が行うこと

1. 導入先を決め、AIへ次のように依頼します。

   > このリポジトリへのGitHub操作境界の導入を検討してください。必要な調査とIssueの作成、接続設定案の準備を進め、私が設定・承認する内容をまとめてください。

2. AIが提示する対象リポジトリ、人間の責任者、操作範囲、通信先、保存先、権限、上限を確認します。接続するGitHub App・認証サービス・実行環境の設定は、この採用判断の後に行います。
3. 実証する場合は、専用の試験リポジトリと対象Issueを確認します。AIがbranch・commit・comment・Draft PRを作ること、試行の上限と後片付けの対象を承認します。

毎回YAMLや署名を手入力する運用は想定していません。日常の会話を署名付き依頼へ変換するサービスはP3に含まれないため、未接続の段階では従来のIssue/PR運用を続けます。チャットでの「進めてください」を、この部品が自動で認証済み依頼に変換することはありません。

## AIが準備すること

- 最新の規約、Issue、担当、ready-for-ai、依存、承認、既存claimとbranchを調べます。設計への承認と実環境への接続承認を区別します。
- 公開情報だけで取得できる範囲と、App・監査用の権限が必要な範囲を整理します。未知の情報を補って許可を作りません。
- 対象の数値repository ID、人間ownerの数値ID、必要なdelegateの数値ID/login、P1 profile/grant、保護対象、許可path・操作、期限と上限を設定案にします。
- 認証issuer、現在状態を確認するcontroller、repo外journal、workerへの入力/出力の境界を設計します。認証済みの人間操作を証明できない場合は本番有効化を保留します。
- 設定PRと検証計画を用意し、人間が行う管理画面での操作と、AIが実行する試行を分けて提示します。新しいIssueが必要ならAIが作成します。

## 接続に必要なもの

| 項目 | 確認する内容 |
| --- | --- |
| 認証入口 | controllerの信頼設定にあるEd25519 issuer。人間の明示操作・GitHub数値ID・対象digestを結び付ける。鍵だけでは本人操作の証明にならない |
| 読取り | GitHub.com REST `2026-03-10`。公開repoのGETには無認証transportを利用可能。非公開repoや保護設定の観測には別途確認済みの接続が必要 |
| 書込み | 対象repo 1つへ限定したGitHub App installation token。`metadata:read, contents:write, issues:write, pull_requests:write, administration:read`だけを要求し、実応答も照合 |
| 保護設定 | default/main等にPR経由の更新、force push・削除の制限。legacy protectionと適用rulesets、実brokerのbypassを観測 |
| 実行権限 | trusted providerがrun/claim/worker/generation、予約、停止、現在headを確認。workerの自己申告では代用不可 |
| 保存先 | controller専用、repo外の実directory、mode0700。journalは0600。workerに書込み権限を与えない実環境側の隔離が必要 |
| 実行環境 | Node.js 22以上、live HTTPのみPython 3.10以上。proxy/CA/TLS確認を維持し、api.github.comへの通信を許可した環境 |

Appの秘密鍵はrepo外のprivateな通常fileを明示指定します。`createGitHubAppTokenProvider`を構築しただけでは鍵を読まず、tokenも発行しません。controllerが`enabled:true`で設定して`issue()`を呼んだ場合だけ発行します。所有者の広いPATはbrokerに使いません。tokenはopaque session内に保持し、workerのJSON、argv、receipt、公開ログへ渡しません。終了時には`revoke()`で専用tokenを失効します。失効結果が不明な場合は確認が必要です。

GitHubは取得権限によってrulesetの`bypass_actors`を省略します。省略と空配列は別です。この版は、適用rulesetにbypass actorがある場合や、teamの範囲が不明な場合も保留します。独立した監査接続が完全な設定を観測できる構成を検討し、brokerへ`administration:write`を追加して通過させないでください。署名付き監査証明を受け取る専用adapterは、この版にはありません。

## データと実行権限の違い

schemaと合成例は[github/v1](../../.ai-workflow/templates/github/v1/README.md)にあります。

`collectGitHubSnapshot`は全stateのIssue/PR、branch、会話、review、指定actorの権限と保護条件を取得します。PR混在を分類し、全pageを検査し、終了時に一覧・対象Issue・保護設定を再確認します。取得不能、上限超過、途中変更は空集合にしません。複数APIにまたがる原子的snapshotは保証しません。

`verifyRunAuthorization`は署名付き依頼と人間操作の証明を、現在のGitHub source・owner/delegate・担当・ready・契約/設計/profile digest・実行予約・権限へ照合します。providerは操作前にも実読戻しを行い、使用API数を`api_requests`で申告します。観測の時刻やpage metadataの違いだけは更新できますが、内容の違いを無視しません。snapshotは60秒以内、最初の依頼受理は5分以内です。同じevent/nonceを同じrunへ記録した後は、承認済みrun/profileの期限と撤回条件で継続します。

JSONのauthorizationやP1 factsは記録です。brokerへ渡す権限は同じcontroller内のopaque capabilityで、JSONから復元できません。再起動時は署名と実状態を再検査します。synthetic試行ではP1 factsを`unknown`とし、本物の人間認証や資源予約を確認済みにしません。

controllerのコード・issuer・観測callback・保存先は信頼基盤です。callbackは不明な予約や権限を`true`で埋めず、実API数と停止状態を正しく返す必要があります。このライブラリだけでは別process/hostのworkerを隔離できません。

## 操作と復旧

brokerは、指定branchの作成、検査したfile変更からの単一parent commit公開、指定Issueへの機械記録、同repoのDraft PR作成/既知PR更新に限定します。main/tag更新、merge、deploy、force push、管理設定の変更は提供しません。

commitは全treeと変更manifestを検査し、Git SHA-1を照合します。通常fileだけを扱い、symlink/submodule、危険path、workflow変更、未対応形式は拒否します。既存treeを再構成できないrepoは保留します。refは直前のhead確認と`force:false`、操作後の読戻しを使います。GitHubには汎用の「旧SHAが一致する場合だけ更新」の引数がないため、外部更新との完全な排他は保証しません。

各操作はoperation IDと要求digestをjournalへ記録し、送信前にfsyncします。同IDの違う要求は拒否します。応答喪失後はbranch/PR/commentの実状態を照合し、見つからないだけで再POSTしません。`unknown`、途中状態、部分失敗が残れば新しい操作を止めます。自分の操作でbranch/headやsourceが変わった場合も、次の操作では現在snapshotとgrantを再検査します。

破損したjournal、途中の行、別controllerのlock、stale lockは自動修復・奪取しません。停止したcontroller、GitHubの実状態、最後の送信/読戻しを人間と確認してから復旧します。hash chainは破損の検出用であり、host管理者による履歴全体の置換・巻戻しを防ぐ証明ではありません。journalを失った場合、同じ操作を新しい記録で再送せず手動照合へ戻ります。

手動Markdown v1の着手記録は解析しません。人間が旧コメントIDと本文digestを照合して`manual_mappings`を作ります。未照合やactive claimは保留します。機械記録の収集だけでは孤立branchやclaimの予約競合を解決しないため、正式なP4移行/予約の観測がないscopeで無人書込みを有効化しません。

## 限定実証

試験repo、1つの実Issue番号、owner、branch、path、issuer、App、保存先、保護条件を人間が確認した後、別の信頼されたcontrollerから`runLimitedTrial(config)`を呼びます。secretを引数の文字列、公開Issue、チャットへ貼り付けません。

- 上限は15分・100 API要求・1 repo・1 Issue・1 branch・新規file 1個（1 KiB以内）・1 commit・2 comments・1 Draft PRです。
- `mode:live`はこのpackageの実HTTP broker transportだけを受け付けます。`mode:synthetic`は偽API用で、実連携の証拠になりません。
- controllerは`prepare`で現在の入力を用意し、`observe`で実状態を確認します。渡された計数付きGET専用transportを使い、全取得/準備要求を100回の枠に含めます。操作ごとに現在のsnapshot/grant/headを再確認します。
- 実行順はbranch、claim、commit、結果記録、Draft PRです。不明・失敗で停止し、成功済みと不明なreceiptを残します。結果記録はrunの予約解放を代行しません。
- 試行後は専用tokenを失効し、作成物を人間が確認します。自動cleanupはありません。PRのcloseとbranch削除を行う場合は、記録した自身のPR番号・repo・author・head SHAを照合して、その試行分だけを対象にします。repo削除や保護変更は行いません。claimの後処理も別途確認します。

`npm run test:live --prefix tools/workflow-github`は設定を自動探索しません。未接続なら`not_evaluated`と終了コード2を返し、APIを呼びません。通常CIもこの入口を呼びません。実証できた場合も、合成issuerでは`real_human_identity`が未評価のままです。実会話への接続、実worker隔離、Dispatcher予約の能力試験はP4/P5以降で行います。

取得・操作の上限、APIとオフライン実行は[記入例とAPI](../../.ai-workflow/templates/github/v1/README.md)を参照してください。
