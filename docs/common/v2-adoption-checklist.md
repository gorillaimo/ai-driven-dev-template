# v2試用前の確認表

初期範囲の機能実装は揃っています。現在は`2.0.0-0.dev.0`の開発版です。
この表は導入と試用の判断材料です。Issue #42の完了やCI成功だけで、移行承認・alpha/stable公開を確定しません。

通常の会話開発、必要な範囲で採用する検査ツール、実験段階の接続部品を分けて確認します。必要な開発環境と接続は、利用するAIツール・アプリ・採用する検査に合わせて確認します。

自律実行の既定値と変更方法は[運用マニュアル](operations-manual.md#autonomous-settings)、停止・途中保存・再開の詳細は[設計](native-continuation-design.md)を参照します。設定機能と利用枠に応じた自動停止は未実装です。残量を取得できない環境では件数・時間で区切る設計です。

初回の依頼は[初期セットアップ](operations-setup.md)、日常の依頼は[運用マニュアル](operations-manual.md)を参照してください。この表は採用・移行・Release判断の際に参照し、実行して試す場合は[隔離した導入・移行例](../examples/v2-adoption/README.md)を使ってください。

## 証拠の区分

この文書の1267件・7package等の数値は、後半に記載する初期導入の固定記録です。追加した部品と現在の採用条件は、次の一覧を参照してください。現在のcommitごとの検証結果はIssue/PRと実CIに残します。

| 区分 | 意味 |
| :--- | :--- |
| 確認済み（静的/合成） | 固定入力・隔離コピー・文書/机上確認で結果を確かめた。証拠の種類は行ごとに示す |
| 人間による確認待ち | 実際の使い方、採用、本人・権限・承認・競合、Release可否などを人間が判断する |
| 未検証/任意拡張 | 実案件/他OS/ライブ操作は未検証。追加機構は必要性と別Issue/承認で判断する |

実CIは実際に実行されたテストの証拠です。合成入力によるテストの成功だけでは、実案件の情報が正しいことまでは確認できません。

<a id="optional-components"></a>

## 追加部品の提供範囲と採用条件

P1〜P7は自律開発設計の計画項目IDです。すべてを導入する必要はありません。AIが利用目的に合う部品と必要環境を提案し、人間が接続・採用を判断します。

| 部品 | 提供・確認の範囲 | 必要なもの・残る判断 |
| :--- | :--- | :--- |
| P1: execution | 検証・レビュー・指摘対応の記録形式と静的整合checker | Node.js 22以上。実テスト/レビューの実行・証拠の真正性は別に確認。[記録の使い方](workflow-tools-guide.md#execution) |
| P2: security | 固定scannerの接続、結果検査、アプリCIとの対応、テンプレート自身のSecurity Validation | ローカルで実scannerを動かす場合はDocker等の対応環境と版/DB取得。利用先アプリの対象・通信・保存先は個別採用。[検査手順](workflow-tools-guide.md#security) |
| P3: GitHub操作境界 | 全量取得、署名付き依頼/承認の検査、許可操作・journal・読戻し。合成試験と限定実証 | Node.js、live HTTPではPython、対応する接続と権限。書込み仲介はrepo限定App等を個別設定。会話の本人確認入口は別。[接続準備](github-boundary-setup.md) |
| P4: Dispatcher | Project v2、候補選択・原子的claim・世代/停止/復旧。SQLite・複数プロセスの試験 | Node.js、専用Linux/Python 3.11以上/SQLite 3.35以上、repo外の保護保存先。手動運用から明示移行。[導入・復旧](dispatcher-setup.md) |
| P5: Runner | 隔離Supervisor、実装/検証/別contextレビュー/修正、模擬応答による実CLI/Docker境界試験 | 実モデル試行・容量制限の残検証・採用判定は[#66](https://github.com/gorillaimo/ai-driven-dev-template/issues/66)で保留。production起動拒否を維持。[準備](agent-runner-setup.md) |
| P6: 統合検証 | 固定main/PRの検査計画・実Git/隔離command・結果失効・元Issueへの修正要求 | 対応するDocker検証環境、承認済みprofileとP3/P4権限。GitHub要約には専用permit等が必要。実モデル起動とは別。[利用手順](workflow-tools-guide.md#integration-verification) |
| P7: 継続制御 | 合成hostで次batch選択・局所保留・合算上限・停止/照合・安全な報告。P3〜P6を使う合成E2E | 合成E2Eには既存P4/P5のLinux/Python/SQLite環境。native本人性/権限委譲・実利用量/料金・一般runの実GitHub公開・実モデル継続は未接続/未評価。[APIと境界](../../tools/workflow-continuation/README.md) |

上表は追加部品の実装・合成試験の範囲です。利用先での接続・採用や実モデルでの継続動作を確認済みとするものではありません。無人実行・alpha/stable公開はいずれも別の判断です。アプリ自身のテスト・運用環境も別途確認します。

## 初期導入の確認記録（固定基準）

- 基準main: `ec00ebd1bf750c47a5533f0fc571b86abff6c022`（PR #41マージ後）。
- v1 stable: `v1.0.0` → `f343151ef62cdc1d5ec3fe0cb2d3cfea7d4a0921`。GitHub refと読み取りfetchで照合。
- 隔離確認: 2026-10-31、Linux / Node.js 24.19.0 / npm 11.9.0。既存node_modulesなしのarchiveから導入。
- 実CIの基準証拠: [PR #41のNode22/24](https://github.com/gorillaimo/ai-driven-dev-template/actions/runs/41180021475)と[main push](https://github.com/gorillaimo/ai-driven-dev-template/actions/runs/41182774286)。前者は両jobのstep/log、後者はsuccess状態を確認。
- 初期導入確認時の検証commit・実CI・詳細な実行記録は、[Issue #42](https://github.com/gorillaimo/ai-driven-dev-template/issues/42)と対応PRを参照する。

### 実装と確認の対応

以下の専用テストは、隔離した全回帰で実行済みです。ここでのコマンドはrepository rootから、必要な依存を導入した後に実行します。

| 機構・元Issue/PR | 入口・確認方法 | 結果と未評価 |
| :--- | :--- | :--- |
| Issue schema：#14 / #15 | `.ai-workflow/schemas/issue/v1/`、`node tools/workflow-schema/validate.mjs` | 確認済み（静的/合成）：93件。形式適合は承認/完了の証明ではない |
| モジュール式ルール：#16 / #17 | `tools/workflow-rules/`、`npm test --prefix tools/workflow-rules` | 確認済み（静的/合成）：32件。AGENTS/共通規約をalways-onで保持。自然文の意味・実承認は人間による確認待ち |
| plan/state・再開：#18 / #19 | `tools/workflow-check/`、`npm test --prefix tools/workflow-check` | 確認済み（静的/合成）：75件。次工程の提案であり、実行・実Git差分取得ではない |
| 追跡性：#20 / #21 | `tools/workflow-trace/`、`npm test --prefix tools/workflow-trace` | 確認済み（静的/合成）：63件。実アプリのテスト成功や自然言語ACの完全性は未検証 |
| Brownfield：#22 / #23 | [調査ガイド](brownfield-analysis-guide.md)、`npm run test:brownfield --prefix tools/workflow-schema` | 確認済み（静的/合成）：29件。実案件の調査は別途scopeを定めて行う |
| Golden：#24 / #25、#40 / #41 | `tools/workflow-golden/`、`npm test --prefix tools/workflow-golden`、`node tools/workflow-golden/run.mjs --json` | 確認済み（静的/合成）：ハーネス155件、固定37case。実排他・Dispatcher障害は未検証 |
| CI/保存Issue検査：#26 / #27 | `.github/workflows/workflow-validation.yml`、`npm test --prefix tools/workflow-ci` | 確認済み（静的/合成）：53件。基準の実CIは上記。保存Project走査・アプリのbuild/testは対象外 |
| Project成果物：#28 / #29 | `.ai-workflow/schemas/project/v1/`、`npm run test:project --prefix tools/workflow-schema` | 確認済み（静的/合成）：193件。利用先のProject採用は任意 |
| Project依存/wave：#30 / #31 | `tools/workflow-project/check.mjs`、`npm test --prefix tools/workflow-project` | 確認済み（静的/合成）：141件。実担当・着手の許可ではない |
| member/ownership/capacity：#32 / #33 | `tools/workflow-project/members.mjs`、`npm run test:members --prefix tools/workflow-project` | 確認済み（静的/合成）：166件。本人確認、権限の確認、全量claimの真正性の確認は、人間による確認待ち |
| 手動Coordinator：#34 / #35 | [手順](manual-coordinator.md)、[様式](../../.ai-workflow/templates/project-manual/v1/README.md)、[机上例](../examples/project-manual/walkthrough.md) | 確認済み（文書/机上）：割当・claim・stale・release/再割当。実案件の引継・原子的排他は未検証 |
| 集約/reconciliation：#36 / #37 | `tools/workflow-project/aggregate.mjs`、`npm run test:aggregate --prefix tools/workflow-project` | 確認済み（静的/合成）：107件。明示snapshotから集約し、実GitHub取得/自動修復は行わない |
| 次作業推薦：#38 / #39 | `tools/workflow-project/recommend.mjs`、`npm run test:recommend --prefix tools/workflow-project` | 確認済み（静的/合成）：160件。未割当は相談まで、実操作は人間による確認待ち |

専用テストは計1267件、固定Goldenは既存12＋Project25の37caseです。Project設計第17章1〜8に対応します。
番号から参照する場合は[Issue一覧](https://github.com/gorillaimo/ai-driven-dev-template/issues)・[PR一覧](https://github.com/gorillaimo/ai-driven-dev-template/pulls)を使ってください。

## Dispatcherの追加確認

上記1267件は初期導入確認時点の固定基準である。追加したProject v2・候補選択・単一Linuxホストの排他台帳/P3接続は[Dispatcherの設計](dispatcher-design.md)と[導入・復旧](dispatcher-setup.md)を参照する。専用テストは`npm test --prefix tools/workflow-dispatch`で実SQLite・複数プロセス・COMMIT前後の強制終了・外部応答喪失を検証する。最新commitの実行結果はIssue #49と対応PRへ記録する。既存Golden Test単独を実排他の証拠とは扱わない。実AI起動・隔離・自律継続とstable Releaseは対象外である。

## 初期導入・移行・復旧の確認結果

| 確認項目 | 証拠・結果 | 次の判断 |
| :--- | :--- | :--- |
| 新しいコピーからの導入 | 確認済み（隔離実行）：7packageをlockfile/ignore-scriptsで導入、1267件・Golden37case成功、元の627ファイルのhash一致 | 人間による確認待ち：利用先固有の構成・必要な採用範囲 |
| Goldenだけの依存 | 確認済み（別の隔離実行）：rules/check/trace/golden/projectの5packageでハーネス155件・固定37case成功。schema/ciのnode_modulesなし | 同じcommitのtool/schema/tests/fixtureを保持する |
| 単一Issue・任意Project | 確認済み（明示入力例）：project_idなしで次intake、計画/member/集約pass、推薦はask_coordinator。実Project台帳を作成せず実行 | 人間による確認待ち：実Issue・担当・証拠・承認・競合の確認 |
| v1からの段階導入 | 確認済み（合成）：rules/checkを選択導入し、AGENTS/共通規約と利用先独自3fileの計5file、v1参照19file・backupを保持 | 人間による確認待ち：既存規約の差分レビューと実案件への採用 |
| 不足/非対応で停止 | 確認済み（合成）：version999とcontext欠落がschema_invalid/blocked/next_stage:null、元入力hash一致 | 自動再試行せず、契約・現在地・承認を人間が照合 |
| 手動運用へ戻す | 確認済み（机上）：元入力/backup/利用先変更を残して合成引継記録を作成 | 実案件の停止・未push・引継・再開判断は人間による確認待ち |

## 試用とReleaseの判断

[versioning-policy第5章](versioning-policy.md)の基準は変更しません。

| 条件 | 現在の整理 |
| :--- | :--- |
| 初期schema/validator/手動運用/Golden/CIの実装 | 確認済み（静的/合成と上記の実CI）。機構の存在と実案件での運用承認を区別する |
| v1移行/fallback、互換性・既知制約 | 合成経路を確認し文書化。実案件での採用・妥当性は人間による確認待ち |
| Security/Privacy/NFR/Resiliencyの未確認事項がstable利用を妨げない | 人間による確認待ち。実際の本人確認・権限・証拠、scope・未push変更・引継ぎ・障害対応、他OSでの動作は、静的な検証だけでは確認できない |
| マニュアルの使いやすさ、移行結果/fallbackの承認 | 人間による確認待ち。下の観点でレビューする |
| 対象version/commit・Release notes・公開の明示承認 | 人間による確認待ち。Release専用Issue/PRで判断。現在のVERSIONは開発版のまま |
| Projects / Dispatcher / Runner | 任意拡張。Runnerの実験実装（#50）と実運用前検証・採用判定（[#66](https://github.com/gorillaimo/ai-driven-dev-template/issues/66)）を分ける。実験実装をマージしてもproduction・無人実行は未有効。[準備と未採用条件](agent-runner-setup.md)を参照。v2初期範囲の必須条件は変更しない |

### 人間がマニュアルを見直す観点

- セットアップ時に伝えるプロジェクト全体の目的と、各Issueで達成したいことを区別できるか。
- 具体的な作業の指示と、次の作業の判断をAIに任せる依頼の両方を使えることが分かるか。
- 「AIへ読ませる文書」「Node.jsで実行する検査」「アプリ自身のテスト」を区別できるか。
- いつplan/stateやProjectを採用し、いつ従来の単一Issue運用を継続するか選べるか。
- checkerのpass/eligible/候補を、担当確定・承認・工程完了と誤読しないか。
- 停止理由と相談先、元記録を保持して手動運用へ戻す手順が分かるか。
- 残る未確認事項を受け入れて試す範囲と、Release前に解消する事項を判断できるか。

セットアップ・詳しい依頼例・機構別コマンドは、運用マニュアルから必要な資料を参照できます。

このレビューと必要な修正の後、試用版alphaか正式版stableかを含めてRelease可否を別途判断します。

## 用語の読み替え

| 用語 | 意味 |
| :--- | :--- |
| assignee / human_owner | Issueの責任を持つ人間 |
| claim | 誰がどの範囲に着手するかの記録 |
| Coordinator | 担当割当・競合・引継ぎを調整する人間 |
| plan / state | 作業予定表 / 現在地と追記履歴 |
| context / snapshot | 人間や既存ツールが確認した、その時点の状況 |
| Quality Gates | 性能・安全性・失敗時の復旧を確認する観点 |
| Golden Test | 固定した入力を使い、判定結果と正解見本の違いを検出するテスト |
| fallback | 問題時に元記録を保ち、手動確認による運用へ戻ること |

## 複数PRの統合検証を使う場合

- 検査image/command・必要な分類・期限・資源上限・保護保存先を提案し、承認済みexecution profileと対応付ける。
- P3/P4の実際の権限とtask handle、P6 profile承認元をhost側で照合する。合成試験で代用しない。
- 元branchを保つ実Git/隔離commandの試験、許可したPR群の限定実証、停止/失効/二重公開防止を確認する。
- 人間はGitHub要約を入口に、必要なときに保護記録を確認する。各マージ後に残りを再検証する。
- v2コメントの非claim確認と既存v1 source mappingを済ませる。新形式を権限根拠にしない。
- P5実モデル/production Runnerの採用と有効化、常駐の自律継続、v2 stable公開は別の条件として確認する。

## 継続制御の合成実験

`npm test --prefix tools/workflow-continuation`で、全量候補選択・次batch・P3/P4/P5/P6の合成E2E、停止/再開・再送・上限・保護記録を確認する。実行結果はIssue/PRへ記録する。native認証/権限委譲・実利用量/料金・一般runの実GitHub報告・実モデル試行は未評価として残す。#68完了で親#52や保留中#66、production/無人運転、stable Releaseを完了扱いにしない。
