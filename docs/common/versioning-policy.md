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

利用開始時に参照したtemplate tagまたはcommitをプロジェクト文書へ記録することを推奨する。v2のproject schema実装後は、template origin versionの機械可読な記録場所を別Issueで定義する。

## 8. 参照

- `VERSION`
- `CHANGELOG.md`
- `docs/common/migration-v1-to-v2.md`
- `docs/common/adaptive-workflow-design.md`
- `docs/common/project-orchestration-design.md`
- [v1.0.0 Release](https://github.com/gorillaimo/ai-driven-dev-template/releases/tag/v1.0.0)
