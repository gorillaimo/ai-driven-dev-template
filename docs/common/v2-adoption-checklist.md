# v2試用前の確認表

初期範囲の機能実装は揃っています。現在は`2.0.0-0.dev.0`の開発版です。
この表は導入と試用の判断材料です。Issue #42の完了やCI成功だけで、移行承認・alpha/stable公開を確定しません。

最初にこの表と[運用マニュアル](operations-manual.md)を読み、試す場合は[隔離した導入・移行例](../examples/v2-adoption/README.md)を使ってください。

## 確認の基準と区分

- 基準main: `ec00ebd1bf750c47a5533f0fc571b86abff6c022`（PR #41マージ後）。
- v1 stable: `v1.0.0` → `f343151ef62cdc1d5ec3fe0cb2d3cfea7d4a0921`。GitHub refと読み取りfetchで照合。
- 隔離確認: 2026-10-31、Linux / Node.js 24.19.0 / npm 11.9.0。既存node_modulesなしのarchiveから導入。
- 実CIの基準証拠: [PR #41のNode22/24](https://github.com/gorillaimo/ai-driven-dev-template/actions/runs/41180021475)と[main push](https://github.com/gorillaimo/ai-driven-dev-template/actions/runs/41182774286)。前者は両jobのstep/log、後者はsuccess状態を確認。
- この文書変更後の検証commit・実CI・詳細な実行記録は、[Issue #42](https://github.com/gorillaimo/ai-driven-dev-template/issues/42)と対応PRへ記録する。

| 区分 | 意味 |
| :--- | :--- |
| 確認済み（静的/合成） | 固定入力・隔離コピー・文書/机上確認で結果を確かめた。証拠の種類は行ごとに示す |
| 人間確認待ち | 実際の使い方、採用、本人・権限・承認・競合、Release可否などを人間が判断する |
| 未検証/任意拡張 | 実案件/他OS/ライブ操作は未検証。Projects等の追加機構は必要性と別Issue/承認で判断する |

実CIは実際に実行されたテストの証拠です。合成入力の内容が実案件でも真実だという証明ではありません。

## 実装と確認の対応

以下の専用テストは、隔離した全回帰で実行済みです。ここでのコマンドはrepository rootから、必要な依存を導入した後に実行します。

| 機構・元Issue/PR | 入口・確認方法 | 結果と未評価 |
| :--- | :--- | :--- |
| Issue schema：#14 / #15 | `.ai-workflow/schemas/issue/v1/`、`node tools/workflow-schema/validate.mjs` | 確認済み（静的/合成）：93件。形式適合は承認/完了の証明ではない |
| モジュール式ルール：#16 / #17 | `tools/workflow-rules/`、`npm test --prefix tools/workflow-rules` | 確認済み（静的/合成）：32件。AGENTS/共通規約をalways-onで保持。自然文の意味・実承認は人間確認待ち |
| plan/state・再開：#18 / #19 | `tools/workflow-check/`、`npm test --prefix tools/workflow-check` | 確認済み（静的/合成）：75件。次工程の提案であり、実行・実Git差分取得ではない |
| 追跡性：#20 / #21 | `tools/workflow-trace/`、`npm test --prefix tools/workflow-trace` | 確認済み（静的/合成）：63件。実アプリのテスト成功や自然言語ACの完全性は未検証 |
| Brownfield：#22 / #23 | [調査ガイド](brownfield-analysis-guide.md)、`npm run test:brownfield --prefix tools/workflow-schema` | 確認済み（静的/合成）：29件。実案件の調査は別途scopeを定めて行う |
| Golden：#24 / #25、#40 / #41 | `tools/workflow-golden/`、`npm test --prefix tools/workflow-golden`、`node tools/workflow-golden/run.mjs --json` | 確認済み（静的/合成）：ハーネス155件、固定37case。実排他・Dispatcher障害は未検証 |
| CI/保存Issue検査：#26 / #27 | `.github/workflows/workflow-validation.yml`、`npm test --prefix tools/workflow-ci` | 確認済み（静的/合成）：53件。基準の実CIは上記。保存Project走査・アプリのbuild/testは対象外 |
| Project成果物：#28 / #29 | `.ai-workflow/schemas/project/v1/`、`npm run test:project --prefix tools/workflow-schema` | 確認済み（静的/合成）：193件。利用先のProject採用は任意 |
| Project依存/wave：#30 / #31 | `tools/workflow-project/check.mjs`、`npm test --prefix tools/workflow-project` | 確認済み（静的/合成）：141件。実担当・着手の許可ではない |
| member/ownership/capacity：#32 / #33 | `tools/workflow-project/members.mjs`、`npm run test:members --prefix tools/workflow-project` | 確認済み（静的/合成）：166件。実本人・権限・全量claimの真正性は人間確認待ち |
| 手動Coordinator：#34 / #35 | [手順](manual-coordinator.md)、[様式](../../.ai-workflow/templates/project-manual/v1/README.md)、[机上例](../examples/project-manual/walkthrough.md) | 確認済み（文書/机上）：割当・claim・stale・release/再割当。実案件の引継・原子的排他は未検証 |
| 集約/reconciliation：#36 / #37 | `tools/workflow-project/aggregate.mjs`、`npm run test:aggregate --prefix tools/workflow-project` | 確認済み（静的/合成）：107件。明示snapshotから集約し、実GitHub取得/自動修復は行わない |
| 次作業推薦：#38 / #39 | `tools/workflow-project/recommend.mjs`、`npm run test:recommend --prefix tools/workflow-project` | 確認済み（静的/合成）：160件。未割当は相談まで、実操作は人間確認待ち |

専用テストは計1267件、固定Goldenは既存12＋Project25の37caseです。Project設計第17章1〜8に対応します。
番号から参照する場合は[Issue一覧](https://github.com/gorillaimo/ai-driven-dev-template/issues)・[PR一覧](https://github.com/gorillaimo/ai-driven-dev-template/pulls)を使ってください。

## 導入・移行・復旧の確認

| 確認項目 | 証拠・結果 | 次の判断 |
| :--- | :--- | :--- |
| 新しいコピーからの導入 | 確認済み（隔離実行）：7packageをlockfile/ignore-scriptsで導入、1267件・Golden37case成功、元627fileのhash一致 | 人間確認待ち：利用先固有の構成・必要な採用範囲 |
| Goldenだけの依存 | 確認済み（別の隔離実行）：rules/check/trace/golden/projectの5packageでハーネス155件・固定37case成功。schema/ciのnode_modulesなし | 同じcommitのtool/schema/tests/fixtureを保持する |
| 単一Issue・任意Project | 確認済み（明示入力例）：project_idなしで次intake、計画/member/集約pass、推薦はask_coordinator。実Project台帳を作成せず実行 | 人間確認待ち：実Issue・担当・証拠・承認・競合の確認 |
| v1からの段階導入 | 確認済み（合成）：rules/checkを選択導入し、AGENTS/共通規約と利用先独自3fileの計5file、v1参照19file・backupを保持 | 人間確認待ち：既存規約の差分レビューと実案件への採用 |
| 不足/非対応で停止 | 確認済み（合成）：version999とcontext欠落がschema_invalid/blocked/next_stage:null、元入力hash一致 | 自動再試行せず、契約・現在地・承認を人間が照合 |
| 手動運用へ戻す | 確認済み（机上）：元入力/backup/利用先変更を残して合成引継記録を作成 | 実案件の停止・未push・引継・再開判断は人間確認待ち |

## 試用とReleaseの判断

[versioning-policy第5章](versioning-policy.md)の基準は変更しません。

| 条件 | 現在の整理 |
| :--- | :--- |
| 初期schema/validator/手動運用/Golden/CIの実装 | 確認済み（静的/合成と上記の実CI）。機構の存在と実案件での運用承認を区別する |
| v1移行/fallback、互換性・既知制約 | 合成経路を確認し文書化。実案件での採用・妥当性は人間確認待ち |
| Security/Privacy/NFR/Resiliencyの未確認事項がstable利用を妨げない | 人間確認待ち。実本人/権限/証拠、実scope/未push/引継・実障害、他OS等を静的確認で埋めない |
| マニュアルの使いやすさ、移行結果/fallbackの承認 | 人間確認待ち。下の観点でレビューする |
| 対象version/commit・Release notes・公開の明示承認 | 人間確認待ち。Release専用Issue/PRで判断。現在のVERSIONは開発版のまま |
| Projects / Dispatcher / Runner | 未検証/任意拡張。v2初期範囲の必須条件ではなく、必要性と別承認で判断 |

### 人間がマニュアルを見直す観点

- Issue作成から設計承認・テスト・PRまで、人間が依頼/判断する時点を追えるか。
- 「AIへ読ませる文書」「Node.jsで実行する検査」「アプリ自身のテスト」を区別できるか。
- いつplan/stateやProjectを採用し、いつ従来の単一Issue運用を継続するか選べるか。
- checkerのpass/eligible/候補を、担当確定・承認・工程完了と誤読しないか。
- 停止理由と相談先、元記録を保持して手動運用へ戻す手順が分かるか。
- 残る未確認事項を受け入れて試す範囲と、Release前に解消する事項を判断できるか。

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
| Golden Test | 固定した入力と正解見本で、運用の判定のずれを検出するテスト |
| fallback | 問題時に元記録を保ち、手動確認による運用へ戻ること |
