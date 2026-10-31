# Template Versioning and Release Policy

このドキュメントは、AI Driven Development Template本体のrelease version、release channel、互換性、保守、成果物schemaとの境界を定義する。

## 1. 現在の状態

- 公開済みstable: `v1.0.0`
- `v1.0.0`のcommit: `f343151ef62cdc1d5ec3fe0cb2d3cfea7d4a0921`
- `main`の目標version: ルート`VERSION`に記載する`2.0.0-0.dev.0`
- `main`の状態: v2 development line。stableではない
- `v2.0.0`stable Release: 未公開

Issue #8より前をv1世代、Issue #8以降をv2開発世代として扱う。ただし、世代の境界はIssue番号だけでなく、Git tagとcommitで固定する。

## 2. Versionの責務

### 2.1 Template release version

template全体の利用者向け契約を表す。ルート`VERSION`、Git tag、GitHub Release、`CHANGELOG.md`で管理する。

Semantic Versioningの`MAJOR.MINOR.PATCH`を使う。

- MAJOR: 利用者の運用、成果物配置、必須契約、移行方法が大きく変わる世代変更。
- MINOR: 後方互換な機構、adapter、任意機能の追加。
- PATCH: 後方互換な不具合修正、説明修正、安全なrule修正。

### 2.2 `schema_version`

plan、state、traceability、Brownfield、project、teamなど、個別の機械可読成果物の形式を表す。template release versionとは独立させる。

- template v2で最初に導入するschemaは`schema_version: 1`でよい。
- 互換性を壊すschema変更時だけ、そのschemaのmajor versionを上げる。
- template versionがminor / patch更新されても、schemaが変わらなければ上げない。
- 複数schemaが異なるversionを持つことを許可する。

#### Issue成果物schema v1の互換性と移行

Issue成果物v1の実装は`.ai-workflow/schemas/issue/v1/`に置く。各成果物で`schema_version: 1`を要求し、非対応versionを自動変換・推測して受理しない。core fieldは未知fieldを拒否するため、受理集合を変える追加、必須化、型変更、enum変更は新majorのschemaとして追加する。説明修正など受理集合を変えない修正は同じmajorに適用できる。独自情報は既存の`extensions`へ保存し、意味が不明な拡張から工程通過や承認を決定しない。

移行時は元成果物と参照したtemplate commitを保存し、対応する新schemaのテンプレートへ明示的に項目を移す。新旧ID、計画revision、追記履歴、承認参照を人間が比較し、形式検証後に利用を切り替える。v1より前の文書運用には機械成果物がないため、空の完了履歴を補完せず実際のIssue記録から初期化する。

破損・非対応version・復元不能な参照の場合は自動再開を止める。元ファイルを保存し、最後に確認できたGit commitとIssue／PR記録へ戻り、人間が現在地を確認する。復元できない承認は再承認を受ける。復元が難しい場合もIssue、assignee、着手コメント、branch、PRによる従来運用を継続できる。schema移行ツールと状態復旧checkerは後続Issueで扱う。

### 2.3 その他のversion

rule version、prompt version、Golden Test fixture version、AI評価設定versionもtemplate release versionから分離する。変更対象の互換性と再現性に必要な単位だけをversioningする。

## 3. Release channel

| Channel | 表記例 | 用途 |
| :--- | :--- | :--- |
| development | `2.0.0-0.dev.0` | `main`の目標開発ライン。GitHub Releaseを作らない |
| alpha | `v2.0.0-alpha.1` | 最初の利用可能なschema、checker、手動運用の統合検証 |
| beta / rc | `v2.0.0-beta.1`、`v2.0.0-rc.1` | 移行検証、互換性修正、stable候補。必要な場合だけ使う |
| stable | `v2.0.0` | release criteriaと移行条件を満たした一般利用版 |

`VERSION`のdevelopment値は公開済みstableを意味しない。`0.dev.0`はSemVerのpre-release順序で`alpha.1`より前になる開発用識別子である。公開済みversionはGit tagとGitHub Releaseで判断する。

## 4. v1系

### 4.1 Baseline

`v1.0.0`は、promptと文書を中心とする軽量なIssueベース運用の固定基準である。adaptive workflowとproject orchestrationのschema、checker、自動化を含まない。

### 4.2 利用継続

v1の運用を固定して利用する場合、`main`ではなく`v1.0.0`tagを参照する。tagは移動・再作成しない。

### 4.3 保守branch

現時点では`release/1.x`を作らない。次をすべて満たす場合に、`v1.0.0`から作成する。

- v1利用者へ必要なsecurity、重大不具合、互換性修正がある。
- v2への移行では直ちに解決できない。
- backportする変更と保守期間を人間が承認した。
- v2機構や新しい必須契約をv1へ混入させない。

v1 patchを公開する場合は`v1.0.1`のようにPATCHを上げ、変更内容と保守範囲をRelease notesへ明記する。

## 5. v2系

v2はIssue #8のadaptive workflowとIssue #9のproject orchestrationを、文書だけでなく検証可能な成果物と運用へ移す世代である。既存のIssue契約、assignee、`ready-for-ai`、人間承認、Quality Gatesを廃止しない。

### 5.1 `v2.0.0-alpha.1` criteria

次を満たした最初の利用可能な統合版をalpha候補とする。

- plan、state、traceability、Brownfieldの共通schemaとtemplateがある。
- project、delivery plan、teamのschemaとtemplateがある。
- schema、参照、feature依存DAG、基本状態遷移をオフラインで検査できる。
- Issue中断・再開と手動Coordinator / claimの最小経路を試せる。
- 代表的なLow / Medium / High Riskとproject orchestrationのGolden Testがある。
- v1運用へ戻るfallbackと既知制約が文書化されている。
- 外部AIサービス、GitHub Projects、Dispatcher、Runnerを必須依存にしない。

alphaは試用版であり、schemaや運用が変更される可能性をRelease notesへ明記する。

### 5.2 `v2.0.0` stable criteria

次をすべて満たすまでstableを公開しない。

#### Issue #8の必須範囲

- 共通schemaと成果物template。
- モジュール式rule解決。
- 適応的計画、状態遷移、再開の静的checker。
- フェーズ境界の追跡性checker。
- Brownfield解析template。
- 必須Golden Test fixtureとoffline harness。
- PRで実行するGitHub Actions統合。

#### Issue #9の必須範囲

- project成果物schemaとtemplate。
- feature依存DAG / wave validator。
- member / ownership validator。
- 手動Coordinator、claim、stale / release / 再割当手順。
- GitHubとIssue内部eventのread-only集約と不整合検出。
- AI次タスクrecommenderの決定的な候補選択と停止条件。
- project orchestrationのGolden TestとActions統合。

#### Release品質

- v1からv2へのmigrationとfallbackが検証されている。
- schema互換性とversion上昇規則が文書化されている。
- Security、Privacy、NFR、Resiliencyの未確認事項がstable利用を妨げない。
- 必須CIが成功し、既知のblockerがない。
- `CHANGELOG.md`、migration guide、Release notesが更新されている。
- 人間がstable公開を明示承認している。

### 5.3 v2 minor候補

次はv2.0.0の必須条件に含めない。

- GitHub Projects adapter: `v2.1.0`候補。
- 中央Dispatcher: `v2.2.0`候補。
- 外部Agent Runner: `v2.3.0`候補。

番号は候補であり、実際の依存関係、互換性、同時に公開する変更をrelease Issueで再評価する。

## 6. Release手順

1. release専用Issueを作成し、対象version、commit、scope、非スコープ、migration、検証を定義する。
2. `VERSION`と`CHANGELOG.md`を対象versionへ更新する。
3. 必須CI、Golden Test、migration / fallback検証を実行する。
4. 人間がrelease commitとRelease notesを承認する。
5. 承認済みcommitへ`vMAJOR.MINOR.PATCH[-PRERELEASE]`tagを付ける。
6. tagが意図したcommitを指すことを検証する。
7. GitHub Releaseを作成し、scope、互換性、migration、既知制約を記載する。
8. 公開後にtag、Release、`VERSION`、`CHANGELOG.md`の整合を再検証する。

公開済みtagを移動、force push、同名再作成してはならない。誤りがある場合は影響を公開し、新しいpatchまたはpre-release versionで訂正する。

## 7. 利用先プロジェクトでの扱い

このrepositoryの`VERSION`はtemplate本体のversionであり、利用先アプリケーションのversionではない。テンプレートからrepositoryを作成した後、アプリ独自のversion管理を導入する場合は、両者を混同しない名前と場所へ分離する。

利用開始時に参照したtemplate tagまたはcommitをプロジェクト文書へ記録することを推奨する。Project schema v1ではproject.yamlのtemplate_originへ導入元repositoryのHTTPS URL、SemVer version、40桁commitを明示記録する。利用先アプリのversionとは区別し、合成例のゼロcommitは置換する。

## 8. 参照

- `VERSION`
- `CHANGELOG.md`
- `docs/common/migration-v1-to-v2.md`
- `docs/common/adaptive-workflow-design.md`
- `docs/common/project-orchestration-design.md`
- [v1.0.0 Release](https://github.com/gorillaimo/ai-driven-dev-template/releases/tag/v1.0.0)

## Rule schema v1の互換性

rule/context/resolution schemaは`.ai-workflow/schemas/rules/v1/`に置きます。
coreの未知fieldは拒否します。受理集合を変えるfield・enum・型・必須性の変更は新しいschema majorへ追加します。
rule本文/metadataの意味を変更するときはrule versionを更新します。requiresとopt-inは固定SemVerを参照し、
version範囲やlatestから推測しません。非対応schema versionは自動変換しません。
resolver versionは結果の計算規則、source digestは参照原文を含む入力内容の識別用です。
plan schema v1の受理集合は変えず、拡張内容を別のresolution schemaとlibraryで検証します。
同じrule versionでも原文digestが変われば古い結果を使わず、人間がversion更新を確認して再解決します。
初期legacy ruleは1.0.0。旧planのversion文字列1を暗黙に書き換えず、明示移行時に結果を更新します。
移行時の元データ保存・レビュー・従来運用へのfallbackはIssue成果物と同じ原則に従います。

## Checker契約v1の互換性

context/result/state-extensionのschema v1は`.ai-workflow/schemas/checks/v1/`に独立配置します。
既存plan/state schema v1の受理集合を変更せず、extensionsの追加契約をcheckerが別途検証します。
形式適合する旧成果物が、新しい意味検査でblockされる場合があります。これは暗黙移行や完了状態の推測を許可しません。
core field・型・enum・必須性など受理集合の変更は新しいschema majorに追加します。
checker_versionは検査計算規則、input_digestは提出された入力の識別用です。digestは署名・本人認証ではありません。
移行時は元成果物を保存し、snapshot・履歴・scopeを人間が照合してから切り替えます。

## 追跡性checker契約v1の互換性

context/result/suppression-scopeを`.ai-workflow/schemas/trace-checks/v1/`へ独立追加します。
既存traceabilityとplan/stateのv1受理集合を変更せず、新検査の台帳・scopeを別途検証します。
core field・型・enum・必須性など受理集合を変更するときは新しいschema majorを追加します。
checker_versionは検査規則、input_digestは全入力、subject_digestは抑制対象となる実質入力を識別します。
どのdigestも署名や承認者本人性の証明ではありません。
結果だけを保存して次回のpassとして使わず、元入力を再検査します。元成果物を保持した明示移行とmanual fallbackを維持します。

## Project成果物schema v1の互換性

Project schemaの正本は`.ai-workflow/schemas/project/v1/`で、project/delivery-plan/teamとcommonをローカル登録します。
既存Issue共通定義のactor/reference/approval/ID等を参照し、既存Issue schema v1の受理集合は変更しません。
Project schema_version:1、template release version、rule versionは別の責務です。
core field/型/enum/必須性など受理集合を変える場合は、新しいmajor schemaを追加します。説明だけの修正と区別してください。
初期v1はIssues-only/manualです。Projects/Dispatcherは別設計とschema version判断を経て追加し、extensionsで有効化しません。

採用や移行は元台帳と導入元template commitを保存し、ID・由来・人間member・方針・参照を実際の案件に合わせて明示記入します。
形式確認後も、ID/依存/権限/本人性/承認/履歴は別途レビューします。schemaに通るだけで作業を自動開始しません。
非対応versionや破損では自動変換・承認補完をせず停止し、元データを保持して人間へ戻します。
Projectを採用しない従来の単一Issue運用や、Issue/assignee/着手コメント/branch/PRによるfallbackを維持します。

## Project plan checker v1の互換性

依存DAG・wave・改訂validatorのcontext/resultは`.ai-workflow/schemas/project-plan-checks/v1/`に独立配置します。
既存Project/Issue schema v1の受理集合を変更しません。形式適合する計画も、新しい意味検査ではblockされ得ます。
coreのfield/型/enum/必須性など受理集合の変更は新しいschema majorへ追加します。checker_versionは計算規則、canonical digestは入力識別を表し、承認・本人性を認証しません。
元台帳・導入commit・直前snapshotを保持し、ID/依存/改訂と確認記録を人間が照合して明示導入します。
初期revisionは1、history空。改訂は2から昇順で追記し、直前との照合と必要なactive判断を記録します。過去履歴が不明なら捏造せず停止します。
結果は元入力から再計算し、非対応versionや破損を暗黙変換しません。導入しない場合も単一Issue運用と手動Coordinatorへのfallbackを維持します。

## Project member checker v1の互換性

member/ownership/capacity用context/resultは`.ai-workflow/schemas/project-member-checks/v1/`に独立配置し、既存Project/Issue schema・計画checkerの受理集合や判定規則を変更しません。
schema_versionはtemplate version・checker_versionと別管理。core field/型/enum/必須性など受理集合の変更は新しいschema majorへ追加します。
canonical digestは対象台帳と入力の識別、checker_versionは計算規則であり、証拠や人間本人性の認証ではありません。
利用開始時は元台帳/導入commitを保存し、login・area・所有・権限・active claim inventoryと明示評価時刻を人間が確認します。
大小文字違いの重複、不足・古い確認、未対応custom permission等により形式適合する旧台帳もblockされ得ます。元データを保持し、自動補修や代理依頼・承認の捏造をしません。
古い結果を流用せず、入力から再検査します。導入しない場合や復旧不能時も従来Issue/assignee/着手コメント/branch/PRと手動Coordinatorへ戻れます。

## 手動Coordinatorコメント様式の互換性

`.ai-workflow/templates/project-manual/v1/`のv1は人間が記入するMarkdown様式の版です。schema_version、checker_version、template本体のVERSIONとは独立し、既存schemaのfield/enumや判定規則を変更しません。
コメントparser/reducer用の機械契約ではありません。将来の機械処理は別Issueで契約・互換性・既存コメントの扱いを設計し、暗黙に自動解釈しません。
様式や手順を更新するときも既存claimの記録・ID・終了/引継履歴を保持し、導入元commitと実案件への明示採用を記録します。様式をコピーしただけではProject運用や自動処理は有効になりません。
導入/fallbackは[manual-coordinator.md](manual-coordinator.md)とmigration guideに従います。単一Issue運用・legacy always-on規約を維持し、この追加だけでalpha/stable Releaseを公開しません。

## Project aggregate v1の互換性

context/checkpoint/resultは`.ai-workflow/schemas/project-aggregate/v1/`へ独立配置します。既存Project/Issue/checkerのschema v1や計算規則を変更しません。
新schema_version:1はtemplate VERSION・aggregator_version・Markdown様式v1とは別です。coreのfield/enum/型/必須性など受理集合の変更は新schema majorへ追加します。
入力digestは内容の識別、checkpointはevent prefix照合用であり、実GitHubや承認者・生成者の認証ではありません。人間向けコメントを自動解釈する契約にもなりません。
元台帳/Issue成果物/導入commitを保持して明示導入し、非対応/破損/改訂時は暗黙変換しません。詳細はoperations-manualの集約手順を参照します。
導入しない単一Issue運用、legacy always-on規約、手動Coordinatorへのfallbackを維持します。この追加でalpha/stable Releaseを公開しません。

## Project recommendation v1の互換性

project-recommend/v1/context・resultは任意追加の独立契約です。template VERSION、既存Issue/Project/member/aggregate/checkerのschema・受理集合・規約・依存lockfileを変更しません。`recommender_version:1.0.0`は推薦実装の識別子で、template Releaseの公開を意味しません。
contextは原本revision/digestと観測条件へ束縛し、未知core/versionは拒否します。resultは元入力から再計算する提案であり、担当/claim/承認の正本や次回の許可として流用しません。
新規相談/claim依頼には人間確認、すべての提案には実行前再確認が必要です。既存checkerの停止条件とlegacy always-onルールを維持します。破損時は元記録を保ち手動Coordinatorへ戻します。
保証範囲・上限・利用例は[運用マニュアル](operations-manual.md)を参照してください。Project全体Golden・実運用確認は後続対応で、alpha/stable Releaseは作成しません。
