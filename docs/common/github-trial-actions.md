# GitHub限定実証の手動実行

`GitHub Boundary Trial`は、このテンプレート開発でGitHub操作境界を実証するための入口です。人間が手動起動した場合だけ、固定した実装commitを検査して、指定sandboxを操作します。通常のPR/push CIや利用先アプリのテストとは別です。テンプレートをコピーしたrepoでは、repo ID/actor/refの照合で起動を拒否します。

## 対象と実行範囲

| 項目 | 採用設定 |
| --- | --- |
| 実行repo | `gorillaimo/ai-driven-dev-template`（現在Public） |
| 操作先 | `gorillaimo/ai-driven-dev-template-sandbox` / ID 1446360916 / Issue #1 |
| App / installation | 5621990 / 178788421 |
| 実行コード | workflowの`TRIAL_SOURCE_SHA`とcheckoutのrefに同じ40桁SHAを固定 |
| 上限 | controllerのGitHub API要求100回（token発行/失効を含む）、実証15分以内 |
| 作成物 | trial branch 1つ、新規file 1個/1 KiB以内、commit 1つ、機械comment 2件、Draft PR 1つ |
| worker | 起動しない。1つのcontrollerと排他lockのみ |

workflow登録にはdefault branchへの反映が必要です。実装本体の実証待ちPRとは別に、この手動入口を先にレビュー・マージし、固定された実装commitを参照します。実証前に実装本体を完了扱いにしません。実行コードの版を変更する場合も設定PRでレビューし、branch名や任意のcommandを入力して切り替える入口は作りません。

## 人間が設定すること

### 1. Appの専用秘密鍵を登録する

この鍵は今回のGitHub App専用で、GitHubアカウントのパスワードやSSH鍵ではありません。

1. [試験用Appの設定](https://github.com/settings/apps/gorillaimo-workflow-sandbox)の **Private keys → Generate a private key** から`.pem`を取得します。
2. [本体repoのActions Secrets](https://github.com/gorillaimo/ai-driven-dev-template/settings/secrets/actions)で **New repository secret** を選びます。
3. 名前を`TRIAL_GITHUB_APP_PRIVATE_KEY`、値を`.pem`のテキスト全体（BEGIN/END行を含む）として保存します。値はチャット・Issue・PR・コードへ貼り付けません。

Appのinstall先はsandboxだけ、権限はMetadata read / Contents, Issues, Pull requests write / Administration readです。controllerは実際に発行するtokenのscope/期限/repo/actorとmain保護を再確認します。人間からIDが共有されたことや、branchのprotected表示だけでは検査を通過しません。

このrepoの管理者・workflowを書き換える権限を持つ人は、Secretを扱う信頼主体です。公開repoでもSecretの値を公開する設定ではありませんが、公開するworkflowのコードと固定実装SHAをレビューした後に登録します。

### 2. 手動で起動する

1. 本体repoの **Actions → GitHub Boundary Trial → Run workflow** を開きます。
2. branchを`main`、確認欄を`run-sandbox-1446360916-issue-1`にして起動します。既定の`do-not-run`や別ref/actor、Re-run jobsは検証として受け付けません。
3. Summaryと`github-boundary-trial-result`を確認します。結果はAIが本体Issue/PRへ要約します。Secretを登録しただけでは試行は始まりません。

本体の通常CIが緑でも、この手動実証を実行済みとは扱いません。試験対象のIssue・担当・ready・契約・準備sourceを固定入力と照合し、新規comment/変更/未知のclaim等があれば止めます。設定後に試験用Issueを変更した場合は、先に固定入力の見直しが必要です。

## コードが行うこと

GITHUB_TOKENはcontents:readです。Secretを読み込む前に固定sourceのcheckout、install script無効のlocked install、オフラインテストを行います。Secretは専用prepare stepにだけ渡し、そこで環境変数から除いたうえでrepo外のmode0700 directory/0600 fileへ保存します。

実証の書込みは、対象repoだけに絞った専用App tokenで行います。最初に全量snapshotを取得し、その60秒の有効期間を延長しません。各mutation前にIssue、全コメント、権限、legacy protectionを実GETで再確認し、変更や不足なら止めます。実行量はtoken発行/失効を含むcontrollerの全API要求で計数し、最後の1要求と時間をtoken失効用に予約します。source checkout、依存取得、Actionsのmetadata保存は準備処理として分離します。jobは片付け込み20分で停止します。

合成trial issuerを使うため、実API操作が成功しても、本物の人間認証・P4の原子的予約・外部worker隔離・保存先の総合的な保護は未評価のままです。AIの準備コメントを本人の承認証明にしません。

## 結果と後片付け

公開するartifactは1 MiB以下の`public-report.json`だけで、保存期間は3日です。receipt、要求数、固定SHA、失効/cleanup結果、診断コードと未評価を含む公開可能なmetadataです。秘密鍵/token、署名依頼、原文HTTP/commandログ、raw journalは含めません。詳細journalは実行中のrepo外private fileに置きます。公開reportを秘密の保存先の代わりにしません。

保護設定で止まった場合は、`diagnostics`の固定コードで不足箇所を確認します。`protection_legacy_read_forbidden`は保護設定の取得が403、`protection_legacy_bypass_missing`や`protection_legacy_bypass_*_missing`は例外許可の情報不足、`protection_legacy_admins_not_enforced`等は必要な制限の不足、`protection_ruleset_*_unknown`はrulesetの情報不足を示します。APIの応答本文やactor名は公開しません。情報の省略を「例外なし」とみなしたり、診断コードだけで権限を許可したりせず、実設定と取得権限を確認します。

通常終了時は専用tokenを失効し、一時鍵を削除します。失効/cleanup不明、blocked、途中成功、結果fileなし、skipped/cancelledは成功ではありません。強制停止では片付けが完了する保証がないため、人間が試験専用Appを停止/アンインストールして実状態を照合します。

unknownの後にRe-run jobsや新しい操作IDで再送しません。別の手動起動でも、既存trial branch/PR/機械sourceを検出したら書込み前に止めます。復旧はreceiptとGitHubの実状態を照合して判断します。

実証終了後、結果要約を本体Issue/PRへ残します。人間が作成物・claimを確認して試行PRのclose/同branchの削除を行い、不要になったActions Secret、Appの鍵、installationを片付けます。sandbox自体のPrivate化/削除は、その後に対象を確認します。自動merge・repo削除・保護緩和・有料契約変更は行いません。
