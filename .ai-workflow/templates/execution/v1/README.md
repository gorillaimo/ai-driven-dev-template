# execution/v1の記録例

検証・別AIレビュー・実行条件の記録形式と、記録間の整合検査に使います。**全ファイルは合成例です。実際の承認や実行結果ではありません。** Projectの設定は不要です。

通常はAIや検証ツールが記録を生成し、人間はGitHubのIssue・PRで要約と判断事項を確認します。調査やレビューで必要なときにYAMLや保護ログを参照します。設計書には現在の仕様・制約・判断理由を記載し、指示・承認・作業経緯はIssue/PR、進捗・検査詳細は構造化記録へ分けます。

## 記録の役割

| ファイル | 内容 |
| --- | --- |
| profile.yaml | 承認対象の検査条件、対象範囲、有限の上限 |
| grant.yaml | 開始/継続依頼、初期方針と個別承認への参照、AIが選んだ実Issueの有限な一覧 |
| context.yaml | 現在のIssue/commit/設計/権限の束縛、観測した事実、明示的な確認時刻 |
| verification.yaml | アプリまたはテンプレートの実検証結果 |
| review.yaml | 別contextのAIレビュー、実検証への参照、指摘 |
| security-result.yaml | scannerの結果・版・情報取得時刻・指摘。scannerの実行機能は未提供 |
| integration-result.yaml | mainと順序付きPR/head集合の結果。実際の仮統合は未提供 |
| run-report.yaml | 人間向け要約の元になる成果・未確認・判断事項・結果参照 |
| event.yaml | 操作状況の記録。排他・台帳・原子的処理は未提供 |

schemaの正本は[execution/v1](../../../schemas/execution/v1/)、APIと上限は[ツールガイド](../../../../docs/common/workflow-tools-guide.md#execution)です。commonは共通型、resultはchecker出力の契約で、記入用YAMLはありません。

## Projectなしの単一Issue例

repository rootでworkflow-rulesとworkflow-executionの依存をlockfileから導入します。次の例は合成例同士の整合だけを確認し、ファイルを更新しません。

```js
import { loadExecutionEvidence } from './tools/workflow-execution/load.mjs';
import { checkExecutionEvidence } from './tools/workflow-execution/check.mjs';

const base = '.ai-workflow/templates/execution/v1/';
const input = loadExecutionEvidence(process.cwd(), {
  profile: base + 'profile.yaml', grant: base + 'grant.yaml',
  context: base + 'context.yaml',
  verifications: [base + 'verification.yaml'], reviews: [base + 'review.yaml'],
  securityResults: [], integrationResults: [],
});
const result = checkExecutionEvidence(input);
console.log(result.status, result.decision, result.diagnostics);
```

profileの必須checkは合成アプリのテストです。テンプレート自身のchecker/Golden成功で代替しません。セキュリティ・統合の記入例は形式を示す独立例で、このprofileの必須検査には含めていません。

実利用では、合成repository/Issue/actor/日時/commit/設計/結果を実際のものに置き換えます。上流からprofile→対象/検証→review→grant/report等の参照を再計算し、最後にcontextのgrant参照を更新します。参照digestはcanonical JSON（keyをASCII順、配列順を保持）全体のSHA-256です。自己digestは記録に含めません。input_digestは生成元入力の識別値で、生成元が提出されない場合にその真正性は証明しません。

## 失効・修正・人間の例外

- 現在のhead/plan/profileが変わった場合、古い証拠は残し、新しいattemptと証拠を追加します。異なるheadの部分再利用は行いません。同じartifact ID/revisionの内容を上書きしません。
- 修正前のopen指摘を新しいレビューから削除するだけでは解決になりません。安定したfinding_idを維持し、新しいfixed記録のresolutionに元指摘のdigest・修正head/attempt・必要な検証・別contextの再確認レビューを結び付けます。元指摘digestはstatusをopenにしてresolution/exceptionを除いた指摘全体から計算します。
- 再確認レビューのrechecksにはfinding_idと元指摘digestを記録します。レビューが自身を承認する参照は認めません。検証後に再確認し、実装者の自己申告だけでfixedにしません。
- accepted_riskには人間・理由・対象finding/digest・Issue/head・承認参照・期限が必要です。checkerのdecisionはhuman_reviewになり、元のfailed/not_evaluatedをpassedへ変更しません。
- previousは任意の過去入力1つです。提出された履歴の上書き/削除を検査します。提出されていない履歴の完全性や外部本人性は証明しません。loaderでpreviousを使う場合も、別snapshotの明示ファイルを用意し、同じpathを重複指定しません。

秘密情報、ソース全文、生ログは公開記録へ保存せず、アクセス制限した保存先への参照を使います。参照URLや記載commandをcheckerが取得・実行することはありません。原本を保持し、不正・欠落・失効を訂正したうえで再検査します。
