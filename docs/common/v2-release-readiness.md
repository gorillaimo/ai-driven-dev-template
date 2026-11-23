# v2公開前の確認資料

**公開前の判断資料です。タグ・Releaseは未作成で、VERSIONは`2.0.0-0.dev.0`のままです。**
確認基準はmain `91dc223ef77d77d29e512feec5a2164f5a62795d`。実行条件・検査対象head・件数・結果は[Issue #91](https://github.com/gorillaimo/ai-driven-dev-template/issues/91)と対応PRに残します。変更後や公開前には対象commitを再照合します。

最初の公開候補は**`v2.0.0-alpha.1`（試用版）を推奨**します。初期の必須機構を一式で試せる状態を公開し、採用先での確認を進めるためです。stableを選ぶ場合は、必須機構に加え、残る条件を利用上許容できることと公開の明示承認が必要です。[既存の公開基準](versioning-policy.md#5-v2系)は変更しません。

## 必須範囲の対応

以下は実装入口の対応表です。静的・合成検査の成功と、利用先での採用・実際の承認は区別します。

| 必須範囲 | 実装・確認の入口 |
| :--- | :--- |
| Issueの共通schema・成果物テンプレート | [schema](../../.ai-workflow/schemas/issue/v1/) / [利用手順](workflow-tools-guide.md#issue-artifacts) |
| モジュール式ルール解決 | [resolver](../../tools/workflow-rules/resolve.mjs)。AGENTS/共通規約をalways-onで参照 |
| 適応的計画・状態遷移・再開の静的検査 | [workflow checker](../../tools/workflow-check/check.mjs) |
| フェーズ境界の追跡性検査 | [traceability checker](../../tools/workflow-trace/check.mjs) |
| Brownfield解析 | [調査ガイド](brownfield-analysis-guide.md) / [schema](../../.ai-workflow/schemas/issue/v1/brownfield.schema.json) |
| Low/Medium/High・ProjectのGoldenとPR CI | [Golden](../../tools/workflow-golden/run.mjs) / [Workflow Validation](../../.github/workflows/workflow-validation.yml) |
| Project成果物・feature依存DAG/wave | [テンプレート](../../.ai-workflow/templates/project/v1/README.md) / [checker](../../tools/workflow-project/check.mjs) |
| member・ownershipの検査 | [member checker](../../tools/workflow-project/members.mjs) |
| 手動Coordinator・claim・交代/復旧 | [担当調整の手順](manual-coordinator.md) / [詳細](manual-coordinator-reference.md) |
| 明示したGitHub/Issue記録の集約・不整合検出と次作業の推薦 | [aggregator](../../tools/workflow-project/aggregate.mjs) / [recommender](../../tools/workflow-project/recommend.mjs) |

通常の会話方式は、設定・作業選択・検証・PR・保存/報告と限定試用を含む範囲で[#52](https://github.com/gorillaimo/ai-driven-dev-template/issues/52)を受け入れ済みです。[担当者確認から正式レビューへの手順](development-rules.md#pr-owner-confirmation)も提供します。これらの自然言語ルールと、ツールによる機械検査の範囲を区別します。

## 品質・移行と残る判断

| 条件 | 確認済みの範囲と公開前の判断 |
| :--- | :--- |
| 新しいコピーでの導入 | 基準commitの依存なしのコピーへ既存lockfileで14packageを導入。既存回帰・Goldenを確認し、元のtracked fileは不変 |
| v1移行とfallback | v1基準・独自変更・backupを保持し、現在版rules/checkの選択導入を合成projectで確認。正常入力、未知version/不足入力による停止・元入力不変・人間への引継ぎを確認。実案件の採用/復旧は別確認 |
| schema互換性・版の扱い | [版の方針](versioning-policy.md)と[段階移行](migration-v1-to-v2.md)を提供。templateの版とschemaの版は独立。利用先の独自変更は差分レビュー |
| CI・Security/Privacy/NFR/Resiliency | この資料のPRで必要CIを確認。公開時は最終commit・検査対象・結果・DB鮮度/期限を再照合。未実行・skip・0対象・未評価を安全性の証明にしない。残る制約の許容範囲は人間が判断 |
| 文書と公開承認 | CHANGELOG・移行ガイドと下記公開文案をレビュー。alpha/stable、対象version/commit、残る条件を人間が確定し、公開を別途明示承認 |

初期導入例の固定commit・7package・1267件は[当時の記録](../examples/v2-adoption/README.md)として保持しています。今回のコピーの検証や最新CIと混在させません。

## 未提供・未実証と任意の部品

- 利用枠の自動取得・常時監視/強制停止・設定の機械合成、担当者確認前のDraft解除を機械的に防ぐ機能は未提供です。残量を取得できない環境では件数・時間で区切ります。
- 実サービスの強制中断からの復旧、実チーム立会い、全AI環境/全言語/アプリ機能一般の自律成功は未実証です。並行試用は文書2 Issueの範囲で、担当者確認手順の例は机上確認です。
- Projects/Dispatcher/外部Runnerは必須依存にしません。実験用部品と合成検査は維持し、[#66](https://github.com/gorillaimo/ai-driven-dev-template/issues/66)は保留。production Runner・無人運転は有効化しません。[部品ごとの条件](v2-adoption-checklist.md#optional-components)を参照します。
- テンプレート自身の検査とアプリのテストは別です。利用先の対象・データ・権限・実行環境に応じた検証が必要です。

## 公開文案：v2.0.0-alpha.1（未公開）

AIとGitHub Issues・Pull Requestsを使って開発を進めるテンプレートのv2試用版です。具体的な作業を指示することも、次の作業の選択をAIに任せることもできます。人間は目的・必要な承認・成果物を確認し、マージを判断します。

- 作業計画・状態・追跡性・既存コード調査の共通形式、モジュール式ルール、オフライン検査とGolden/CIを提供します。
- チームの計画・担当・依存・手動調整・記録集約・次作業推薦を、必要な範囲で採用できます。
- セキュリティ検査、AIレビューと指摘対応、継続作業の設定・保存/再開、担当者確認から正式レビューへの手順を整理しました。実行能力と必要環境は採用する機能ごとに確認します。
- [セットアップ](operations-setup.md)から始め、v1利用中なら[移行ガイド](migration-v1-to-v2.md)で差分と戻し方を確認してください。通常の会話開発に独自RunnerやGitHub Appの一律導入は不要です。Node.jsは管理ツール用で、アプリの言語は限定しません。

alphaは試用版で、schemaや運用が変更される可能性があります。上記の未提供・未実証範囲と[確認表](v2-adoption-checklist.md)を確認し、採用範囲を決めてください。実験部品の存在やCI成功は、利用先アプリの安全性・無人実行の保証ではありません。

## 公開までに残る操作

1. 人間がalpha/stable/保留と、公開範囲・残る条件を決める。
2. 対象versionをVERSION/CHANGELOGへ反映するPRを用意し、Release専用Issueで最終commitを固定する。
3. 最終commitで必要CI・Golden・移行/fallbackと検査の鮮度を確認し、人間がRelease notesと公開を明示承認する。
4. 承認したcommitへのタグとGitHub Releaseを作成し、版・参照先・内容の一致を公開後にも確認する。公開済みタグは移動しない。

今回の資料PRのマージは、上記の公開許可やVERSION変更を意味しません。
