# ワークフロー検査ツールの利用詳細

AIや導入担当者が必要な検査を選んで実行するための資料です。日常の依頼方法は[運用マニュアル](operations-manual.md)を参照してください。
ツールは構造化入力を検査して結果・候補を返します。AIはその結果と実Issue/PR・承認・競合を確認し、許可された作業を進めます。自然言語の継続依頼だけで常駐の自動実行システムが起動するわけではありません。
Node.jsは開発管理に使い、利用先アプリの開発言語は問いません。アプリ自身のbuild/testは別途用意します。

| 調べたいこと | 利用節 |
| :--- | :--- |
| Issue成果物を用意する | [初期セットアップ](operations-setup.md#issue成果物テンプレートの利用) |
| ルールの適用を決める | [モジュール式ルール](#rules) |
| 計画・現在地・再開候補 | [plan/stateの検査](#workflow-state) |
| 要件とテストの対応 | [対応漏れの検査](#traceability) |
| 既存コードの調査 | [Brownfield](#brownfield) |
| 固定見本との比較 | [Golden Test](#golden) |
| PRでの自動検査 | [GitHub Actions](#ci) |
| Projectの設定 | [台帳の記入](#project-artifacts) |
| 開発の順序 | [依存関係の検査](#project-plan) |
| 担当・着手・引継ぎ | [手動Coordinator](#manual-coordinator) |
| 担当できる条件 | [メンバーの検査](#project-members) |
| 複数Issueの状態 | [集約と不整合](#project-aggregate) |
| 次の1作業 | [推薦](#project-recommend) |
| Projectをまたぐ回帰 | [Project Golden](#project-golden) |

<a id="rules"></a>

## モジュール式ルールの手動利用

Node.js 22以上で`npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund`を実行します。
インストール後、`npm test --prefix tools/workflow-rules`はネットワーク・外部AIなしで実行できます。
既存schemaの回帰は`node tools/workflow-schema/validate.mjs`で実行できます（同パッケージの依存を事前に導入）。

ルール正本は共通の`docs/common/rules/<rule-id>/`または利用先固有の`.ai-workflow/rules/<rule-id>/`です。
各directoryにrule.yamlとrule.mdを対で置き、rule_idとdirectory名を一致させます。
legacy以外はbody_refsに対のrule.mdを含めます。既存IDを同名projectルールで上書きできません。
`.ai-workflow/templates/rules/v1/`は合成記入例であり、自動採用・承認の記録ではありません。
rule.yamlはlegacy参照の例、context.yamlは既知空集合を含む例、resolution.yamlは解決結果の構造例です。
resolutionの入力digestは実際のrepositoryの最新文書から再生成します。

repository rootからの利用例:

```js
import { readFileSync } from 'node:fs';
import { loadRules, parseYaml } from './tools/workflow-rules/load.mjs';
import { resolveRules } from './tools/workflow-rules/resolve.mjs';
import { projectPlan } from './tools/workflow-rules/plan.mjs';

const input = {
  ...loadRules(process.cwd()),
  context: { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] },
  optIns: [],
};
const result = resolveRules(input);
if (result.status === 'blocked') throw new Error(JSON.stringify(result.diagnostics));
const plan = parseYaml(readFileSync('.ai-workflow/issues/issue-123/plan.yaml', 'utf8'));
const candidate = projectPlan(plan, result, input);
// 人間レビュー後、candidateのrevision・更新日時・actorを更新して明示保存する。
```

opt-inの採用例（実際の人間承認参照へ置換）:

```js
const optIns = [{
  rule_id: 'example', version: '1.0.0',
  approval: {
    approval_type: 'opt-in', approved_by: 'example-user',
    reference: { kind: 'url', target: 'https://github.com/example/project/issues/123#issuecomment-1' },
    approved_at: '2026-10-22T00:00:00Z',
  },
}];
```

`loadRules`の失敗、blocked診断、変更されたcontext/本文/digestを無視して以前の結果を使わないでください。
保存直前に再読込・再解決し、requires固定versionと採用承認の有効性を人間が確認します。
診断のcode/rule_id/relatedは機械処理用、説明文はtools/workflow-rules/messages.mjsに集約しています。
承認参照とapproval_requiredは承認そのものではなく、Issueのassignee・ready-for-ai・設計承認を引き続き確認します。
対処不能な場合は元成果物を保持してIssueへ理由を記録し、従来のIssue・branch・PR運用で人間へ戻します。

<a id="workflow-state"></a>

## 計画・状態・再開候補の静的検査

この検査は工程を実行せず、plan/state/contextを読み取って不足や矛盾を返します。
作業予定表（plan）、現在地と履歴（state）、人間が確認した状況（context）を分けて準備します。
記入例は`.ai-workflow/templates/checks/v1/`、全体を試す合成例は`tests/workflow-check/fixtures/`にあります。
JSON表記の例もYAML 1.2として読み込めます。例のID・時刻・参照・digestを実作業へ置換してください。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-check
npm test --prefix tools/workflow-rules
node tools/workflow-schema/validate.mjs
```

依存導入後の検査・テストはネットワーク不要です。既存schemaパッケージの依存は別途導入します。
workflow-checkはworkflow-rulesをfile依存で再利用し、rule側もruntime依存を明示しています。
ruleの計算規則は変更せず、rootにアプリ用package.jsonを追加しません。

repository rootから合成例を検査する例:

```js
import { loadWorkflow } from './tools/workflow-check/load.mjs';
import { checkWorkflow } from './tools/workflow-check/check.mjs';

const input = loadWorkflow(process.cwd(), {
  plan: 'tests/workflow-check/fixtures/plan.yaml',
  state: 'tests/workflow-check/fixtures/state.yaml',
  context: 'tests/workflow-check/fixtures/context.yaml',
  // 実作業の中断再開ではprevious: {plan: '...', state: '...'}も渡す。
  revisionPlans: [],
}, { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] }, []);
const result = checkWorkflow(input);
console.log(result);
```

実作業では、Git/Issueの最新状況を人間が確認してcontextへ反映し、ruleも保存直前に再読込します。
checkerはGitHub照会・Git command・ファイル更新をしません。snapshotの内容が本当かを自動認証しません。
通常ファイルを1 MiBまで読み、root外・symlink・不正YAMLを拒否します。loader失敗時は例外で停止します。
純粋関数checkWorkflowへはJSON相当のobjectを渡します。形式不正は診断付きblockedとなります。

state.extensions.workflow_checkへ承認・検証scopeと改訂情報を追加します。
High Riskは設計と品質確認の両方について、対象revisionの承認参照が必要です。
人間の承認参照を記入しただけで本人性が証明されたり、作業が自動実行されたりすることはありません。
履歴の途中状態、例外skip、標準イベントの具体的な契約はadaptive-workflow-design第5.4・6.4節を参照してください。

checks配列でplan/stateとresumeのどこが止まったかを確認します。
resume_decision: candidateの場合だけnext_stageが1つ提示されますが、これは作業開始命令ではありません。
blockedの場合は元ファイルを保持し、code/path/stage/eventから原因を確認してIssueへ記録します。
中断・失敗時は未完了操作と安全な再実行を確認し、古い履歴や承認を消さず再計画・再承認します。
terminalは完了または取消済みであり自動再開しません。

<a id="traceability"></a>

## 要件・設計・テストの対応漏れを検査する

traceabilityは、受け入れ条件と成果物の「対応表」です。workflow-traceはその対応表を読み、
必要な設計やテストがない、参照先がない、未承認・失敗した検証が完了の根拠になっている、といった不足を返します。
本文やコードの意味を自動理解したり、テストを実行したりする検査ではありません。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-trace --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-trace
```

依存導入後はオフラインで利用できます。workflow-checkのname/version/exportsを明示して内部file依存で再利用し、
既存checkerの計算規則は変更していません。既存の回帰テストも引き続き実行します。

repository rootで同梱の合成例を読み込む例:

```js
import { loadTraceability } from './tools/workflow-trace/load.mjs';
import { checkTraceability } from './tools/workflow-trace/check.mjs';

const input = loadTraceability(process.cwd(), {
  traceability: 'tests/workflow-trace/fixtures/traceability.yaml',
  context: 'tests/workflow-trace/fixtures/context.yaml',
  workflow: {
    plan: 'tests/workflow-trace/fixtures/plan.yaml',
    state: 'tests/workflow-trace/fixtures/state.yaml',
    context: 'tests/workflow-check/fixtures/context.yaml',
    previous: {
      plan: 'tests/workflow-trace/fixtures/plan.yaml',
      state: 'tests/workflow-trace/fixtures/state.yaml',
    },
  },
}, { schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: [] });
const result = checkTraceability(input);
console.log(result.status, result.diagnostics);
// result.checksは転記候補。人間の確認後に明示保存する。
```

例は実作業の承認記録ではありません。実作業ではIssueのAC/非スコープ台帳、変更一覧、最新のworkflow入力、
本当のprevious、外部参照の確認者と時刻を準備します。trace用contextはworkflow用contextとは別ファイルです。
非draft境界では追記性確認を必要とし、previousなしを確認済みとは扱いません。
保存済みchecksのpassを渡しても、現在の入力から再検査します。

まずdraftで警告を確認し、requirements_to_design、design_to_implementation、implementation_to_pr、completionで
必要な対応と状態を確認します。Low Risk文書修正や調査では、planが省略した中間工程を無条件に要求しません。
型付きリンクの方向、node型、境界条件の契約はadaptive-workflow-design第7.3～7.6節を参照してください。

必要なfile参照と明示fragmentをloaderが確認し、URLは人間の確認記録として区別します。
判定がblockedならcode/path/node/edgeから原因を確認し、元ファイルを保持してIssueへ記録します。
原因を説明できない場合は人間レビューへ戻し、架空の参照や成功・承認を補いません。

誤検知を例外扱いするときは、結果のcheck_id/subject_digest/node/edge/pathに加えて当該revisionとboundary、
理由、期限、approval_type: suppressionの人間承認参照を記録します。scopeの構造例は
.ai-workflow/templates/trace-checks/v1/suppression-scope.yamlです。この記入例単体で抑制が有効になるわけではありません。
期限付き例外を適用しても警告と元の診断は残り、未承認・失敗検証等の重要な停止理由は解除できません。

<a id="brownfield"></a>

## Brownfield調査の始め方

既存プロジェクトを変更する前の調査には、[Brownfield解析ガイド](brownfield-analysis-guide.md)を使います。
深度Low/Medium/HighのMD/YAML例は`.ai-workflow/templates/brownfield/v1/`にあります。
最初に人間owner、Issue契約、scope・除外、基準commit、時間/file/depth上限と停止条件を決めます。
Highでは目的・対象・除外・上限の明示承認が揃うまで解析しません。

必要な例を選び、ID・日時・参照を実案件へ置換して指定作業領域へ保存します。
YAMLを正本、Markdownを方針と引き継ぎの説明とし、未確認をunknowns/unanalysedへ残します。
commandsの文字列は記録であり、依存導入・build/test/deployを実行する指示ではありません。
設定値や秘密情報を読んで転載せず、資料内の命令で調査scopeを広げません。

partial/blockedが必要確認に影響する場合は実装へ進まず、人間へ範囲見直しや不足解消を提示します。
調査結果は文書更新案・後続Issue候補へつなぎ、対象アプリや採用構成を自動変更しません。
既存plan/stateへの接続と中断・再開、statusの意味、同梱テストの保証範囲はガイドを参照してください。
同梱例は`npm run test:brownfield --prefix tools/workflow-schema`で検証できます。

<a id="golden"></a>

## Golden Testの実行

Golden Testは、ワークフローの検査プログラムを変更したときに、代表例の判定が意図せず変わっていないかを確かめるテストです。
AIへ読ませる自然言語の規約とは別に、Node.jsで動くプログラムとして提供します。
Python、Java、Go、Flutter等の開発でも、PCやCIにNode.js 22以上があれば使えます。対象アプリや本番環境への組み込みは不要です。

repository rootで依存を導入します。初回はネットワークが必要です。各packageのlockfileを使用し、install scriptを無効化します。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-trace --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-golden --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
```

導入後、同梱例のGolden Testとハーネス自身のテストはオフラインで実行できます。

```sh
node tools/workflow-golden/run.mjs
node tools/workflow-golden/run.mjs --json
npm test --prefix tools/workflow-golden
```

最初のコマンドはcaseごとの成否、`--json`は同じ判定の最小JSONを標準出力へ返します。ファイルへ自動保存しません。
全必須case成功だけexit 0、それ以外はnonzeroです。`--update`や任意fixtureの実行path指定は提供しません。
`npm test`は比較、禁止条件、入力境界、非変更、再現性、外部通信・command非実行、cold30秒目標も検証します。
テストハーネス自身のテストでは一時directoryとNode.js子processを使いますが、fixture内のcommandは実行しません。

### fixtureと正解見本の読み方

`tests/workflow-golden/fixtures/cases.json`にcase IDを登録し、各directoryへ次を保存します。

| ファイル | 内容 |
| :--- | :--- |
| `case.yaml` | format_version、id、目的、adapters、inputs、expected、signals、normalize、任意assets |
| `input/` | 合成Issueの説明、rule metadata、計画候補、状態・previous、境界検査入力など |
| `expected/` | 人間が差分レビューする固定した正解見本。実行中に再生成しない |
| `forbidden.yaml` | format_versionとrules。起きてはならない実結果の値・構造・文字列 |

JSON表記もYAML 1.2として読みます。Issue説明は人間の参照資料で、ツールが自然言語からfactsや計画を生成するわけではありません。
`input/AGENTS.md`等は合成の本文例です。実repositoryのlegacy規約を置き換えません。
実際のAGENTS.mdとdevelopment-rules.mdの読み込みは、別の接続テストで確認します。
参照URL、actor、承認、Git commit、時刻は全て固定合成例であり、実作業の証拠として転用しません。

adaptersはrules、plan、workflow、trace、brownfieldと、後述のProject用4種類の固定集合です。inputsとexpectedは各adapterから相対ファイルへのmap、signalsは期待statusと診断code集合です。
planにはplanとruleInput、workflowにはcheckWorkflowの入力一式、traceにはcheckTraceabilityの入力一式を渡します。
rulesはresolverの入力、brownfieldは既存brownfield schema v1の成果物です。adapter実装をfixture側から差し替えられません。
assetsは入力の補足資料を列挙する相対path配列です。case内の全fileをmanifestかassetsで宣言し、不要fileを残しません。

例えばHigh Riskの承認不足は、checkerがblockedを返すのが正解です。そのとおりならcaseのテスト結果はpassedです。
AC-testの対応漏れは非draft境界でcoverage_missing等によるblocked、draftではorphan_nodeによるwarnを見本にしています。
未使用adapterのnot_evaluatedは「確認していない」という意味で、成功や承認の代わりにはなりません。

禁止条件の記入例:

```yaml
format_version: 1
rules:
  - adapter: workflow
    op: equals
    path: /next_stage
    value: implementation
```

この条件は、次候補がimplementationになったら失敗させます。opはequals、contains、textのみです。
containsは指定pathの部分構造・配列要素、textはJSON表現内の文字列を調べます。存在しないpathは一致なし、未選択adapterの指定は失敗です。
case.yamlのnormalizeは原則`[]`とし、表示専用の最上位`/duration_ms`だけを例外として許可します。
時刻・digest・承認・revision等の重要差分を無視したり、履歴や工程の配列順を並べ替えたりしません。
詳細な上限と契約はadaptive-workflow-design第10.4節に記載しています。

### 期待結果の変更・失敗時の復旧

1. case ID、理由code、adapter、比較pathまたは禁止条件indexを確認します。入力内容や実結果全文は診断へ出しません。
2. 仕様変更か不具合かをIssueと共通設計に照らして確認します。差分を消すためだけに期待見本を変更しません。
3. 仕様変更なら、承認された理由に対応する期待見本・signals・禁止条件を手動編集し、PRで差分をレビューします。
4. 元のfixtureとtemplate commitを保持し、Golden Testと個別checkerの回帰を実行します。通らない場合は元データを残し、人間レビューへ戻します。

既存schema/checkerの移行は不要です。失敗しても実作業のstate、承認、ソースを自動修正せず、個別checkerと従来のIssue・branch・PR運用を継続できます。
保証範囲は同梱合成例の静的回帰です。自然言語の意味、承認者本人性、任意の秘密情報・Issue外変更の検出、調査の真実性を自動保証しません。
実アプリのテスト実行、外部AI意味評価、v2 stable公開は別の作業です。Actions接続は次節を参照してください。

<a id="ci"></a>

## GitHub Actionsでのワークフロー検査

PRを作成・更新すると、Checksに`Workflow Validation (Node 22)`と`Workflow Validation (Node 24)`が表示されます。
main更新と手動操作でも起動します。手動実行はworkflowをdefault branchへマージした後、Actions画面から選択します。
これはテンプレートの開発管理機構の検査です。「ログインできるか」「APIが正しい結果を返すか」など開発対象アプリ自身のテストは、各言語の仕組みと別workflowで用意してください。

実行内容:

1. 専用7package（schema/rules/check/trace/golden/ci/project）のlockfileで依存取得。install scriptsは無効。
2. 既存の静的テスト、Goldenハーネスのテスト、新CI検査・workflow契約テストを実行。
3. Golden固定caseを実行。
4. repositoryに保存したIssue成果物の形式・識別子・必要なローカル参照を検査。

依存取得にはネットワークが必要です。検査は依存導入後オフラインで動き、外部AI・GitHub API・fixture内commandを呼びません。
Ubuntuで検査するため、Windows/macOS固有の挙動やアプリの実行環境を保証するものではありません。

### 保存Issue YAMLの扱い

`.ai-workflow/issues/<work-id>/`にあるplan.yaml/state.yaml/traceability.yaml/brownfield.yamlのうち、存在するものを対象にします。
従来どおりYAMLを保存しない場合は、対象0件で終了します。補助fileやproject領域を自動解釈しません。
既存schema v1に適合し、folderと成果物間の識別子が一致する必要があります。

完了済みstageのartifactとcomplete node、記録済み根拠に必要なローカル参照の欠落はエラーです。
これから作るstage artifact、pending/not_applicable node、Brownfieldの変更・文書更新・後続提案は未評価として残します。
planのstage完了は同directoryのstateで確認し、stateがなければ完了と推測しません。
外部URL、本人性、未対応fragment、名前空間を確定できないIDも未評価です。
trace node/check参照の既知IDとlink endpoint、明示Markdown anchorとJSON Pointerは検査できます。
削除済みfileなど現checkoutだけでは存在を確認できない必要参照を自動承認しません。人間が現存する検証記録への参照を見直すか、既存のcontext付き境界checkerで個別にレビューしてください。

ローカルで同じ検査を実行するには、Golden Test節の既存5packageに加えて次を導入します（schemaテストを実行する場合はworkflow-schemaの依存も導入）。

```sh
npm ci --prefix tools/workflow-ci --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-ci
node tools/workflow-ci/validate.mjs
node tools/workflow-ci/validate.mjs --json
```

結果のartifact_countは対象数、excluded_countはIssue領域の補助file等の除外数、reference_countsはpass/block/not_evaluatedの件数です。
全体passでもnot_evaluatedは未確認のままです。成功は仕様の意味、承認者本人性、工程完了、実装の正しさを保証しません。
詳細な参照方針と上限はadaptive-workflow-design第11.2節を参照してください。自動修正や任意path指定・更新optionはありません。

### 結果・停止・導入の見直し

Checksから失敗したjobのstepとSummaryを確認します。Summaryには依存取得、既存回帰、CI契約、Golden、保存成果物検査のoutcomeを記録します。
Goldenのcase成否と成果物検査の対象数・未評価理由は、それぞれのstepログで確認します。原文のartifact uploadは行いません。
failure/skipped/cancelledと、起動していない検査を成功と読み替えないでください。cancel/runner停止でSummaryがなければActionsのstatusを確認します。

新しいpushで同じPR/refの古い実行はcancelします。各jobは10分以内を目標とし、15分で停止します。
fork PRの初回承認やActions利用制限により未実行となる場合は、保守者がGitHubの画面で状態を確認します。Secretsやwrite権限を与えて通す運用にはしません。
このworkflowはcontents:readとcredential非保持で動き、PRコメント・ラベル・自動承認・merge・deployを行いません。

導入時は新workflow、必要な7tool package、tests、.ai-workflow/schemas、共通文書を一緒に保持してください。
branch protectionやrequired checksは自動変更しません。まず実行時間と誤検知を観測し、人間が必要性を判断してから必須化します。
無効化する場合はGitHubのActions画面でこのworkflowだけを停止するか、レビュー済みPRで新workflowを取り除きます。required checkに設定済みなら、先に人間がその設定を見直します。
失敗時は元成果物・見本を保存してIssueへ理由を記録し、個別checkerと従来のIssue・branch・PR運用で確認を続けられます。
外部AI意味評価とv2 stable公開は今回の対応に含みません。

<a id="project-artifacts"></a>

## Project設定・開発計画・メンバー台帳の記入

3つの台帳を使う場合は、人間が採用範囲を決め、`.ai-workflow/templates/project/v1/`のREADMEとYAMLを参照します。

| 台帳 | 記録するもの |
| :--- | :--- |
| project.yaml | 管理担当、共有領域、membership・状態・claim・同期方針、template由来 |
| delivery-plan.yaml | 機能の参照、依存理由、計画上の優先順位、制約、関連Issue、計画改訂 |
| team.yaml | 人間のメンバー、role、担当可能領域、同時担当上限、統合責任 |

必要なYAMLだけを実際の`.ai-workflow/project/`へ明示コピーし、合成ID・login・参照・日時・Git commit・方針を置換します。
各台帳のproject_idを揃え、featureの目的・詳細要件・ACは利用先のdocs/system-context.mdへ記録します。
未作成Issueはissue_refsを空にし、架空の番号を作りません。例のtemplate_originのゼロcommitは必ず実際の導入元commitへ置換します。
初期対応はIssues-only/manualです。Projects/Dispatcherの設定はこのschemaでは受理しません。
status_mappingは静的な対応表で、ラベル作成や状態変更を実行しません。active:falseでも既存claimを自動解放しません。
YAMLが正本で、delivery-plan.mdは将来の生成表示です。共有Project state.yamlや別の手編集状態台帳は作りません。

同梱例の形式テストは、repository rootから実行します。初回の依存取得は通信し、導入後のテストはオフラインです。

```sh
npm ci --prefix tools/workflow-schema --ignore-scripts --no-audit --no-fund
npm run test:project --prefix tools/workflow-schema
```

これは同梱のschema・記入例・fixtureのテストです。コピーした利用先Projectファイルを自動走査するコマンドではありません。
CIでも同じテストを実行しますが、保存Projectファイルを既存Issue YAML runnerの検査対象へ追加する対応は行っていません。
利用先の台帳はschemaを参照して記入し、人間がID/依存/area/member/権限/参照元/承認をレビューしてください。依存DAG・wave・改訂とmember/ownership/capacityは後掲のvalidatorで追加検査できます。

テスト成功は担当確定・割当可能・承認・着手・完了を意味しません。schemaだけでは循環、重複ID、実在、実権限、承認者本人性を確認できません。
GitHub Issues/PRが実行時のstatus/assignee/claimの正本、台帳は静的方針と承認済み計画です。両者を自動で相互上書きしません。
移行や修正では元ファイルとtemplate commitを保存し、差分を人間がレビューします。不明な承認や改訂履歴を補って通しません。
Project機構を採用しない場合や復旧できない場合も、従来のIssue/assignee/着手コメント/branch/PR運用を継続できます。

<a id="project-plan"></a>

## 機能の依存関係と開発順序を検査する

`tools/workflow-project/`は、機能間の依存関係、同時変更する領域、計画の改訂を検査します。
waveとは、計画上同時に進められる機能のまとまりです。たとえば「共通APIの確定→画面とBackendの実装」の順序を表せます。
同じファイル領域を変更する機能は順番を分け、確認不足や承認待ちの機能とその下流は待機にします。
これはアプリ自身の動作テストではなく、開発管理の検査です。開発対象の言語に関係なくNode.js 22以上で使います。

初回はrepository rootで依存を取得します。既存rulesを先に導入します。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm test --prefix tools/workflow-project
```

最後のコマンドは同梱のvalidatorテストです。実際の計画は、次のように明示指定してlibraryへ渡します。
以下は合成例を読む実行可能な例です。`source_ref`の実ファイルが公開元にないことも未評価として表示し、利用先設定・Issue・承認の実在証明には使いません。

```sh
node --input-type=module <<'NODE'
import { loadProjectPlan } from './tools/workflow-project/load.mjs';
import { checkProjectPlan } from './tools/workflow-project/check.mjs';
const dir = 'tests/workflow-project/fixtures/';
const input = loadProjectPlan(process.cwd(), {
  project: dir + 'project.yaml',
  deliveryPlan: dir + 'delivery-plan.json',
  context: dir + 'context.json',
});
const result = checkProjectPlan(input);
console.log(JSON.stringify(result, null, 2));
NODE
```

実案件ではproject/deliveryPlanを承認済み台帳のpathへ置換し、contextは作業用の一時snapshotとして用意します。
contextの記入例は`tests/workflow-project/fixtures/context.json`、正本は`.ai-workflow/schemas/project-plan-checks/v1/context.schema.json`。
JSONもYAMLも読めますが、contextを共有Project stateとして手編集・正本化しません。実状態の正本はGitHubです。

1. 人間がfeature状態と条件を確認し、observed_at、recorded_by、sourceとevidence参照を記録します。feature_factsは各featureを1件ずつ記入し、不明ならunknownにします。
2. constraint_factsは対象featureと0始まりconstraint_indexで対応させます。省略・unknown・pendingでは条件未成立として待機し、satisfiedには確認のevidenceが必要です。
3. project_revision/plan_revisionとcanonical digestを対象に合わせます。digestは`tools/workflow-rules/resolve.mjs`の`digest(canonical(parsedData))`で計算します。原文のコメントや改行のhashではありません。digest更新は承認操作ではなく、先に人間が内容を確認します。
4. revision 1はhistory空。改訂時はplan revisionを1増やし、historyに理由・approval・影響feature ID・無効化する旧waveを追記します。previousへ直前のproject/deliveryPlan/contextのpathを明示します。古い原本と確認snapshotを保持してください。
5. 影響する進行中featureにはcontinue/pause/cancelの判断とapprovalを記録します。checkerは実状態を変更せず、旧activeをplannedへ戻した再配置も拒否します。

結果の読み方:

| 項目 | 意味 |
| :--- | :--- |
| status: blocked | 形式・ID・DAG・改訂等に問題があり、wavesと候補は空 |
| status: pass | 提出入力の検査成功。待機機能が残っていても、無関係な機能の計画を表示できる |
| waves | 計画上の順序と保守的な並列グループ。完了済み・進行中・未確認条件の機能は再投入しない |
| dependency_candidates | 最初のwave内で、先行機能がすべて完了している機能。担当やclaimの許可ではない |
| waiting / serialization | 待機理由と、領域の重複により後回しにした代表的な根拠 |
| revision_impact | 旧新入力から計算した変更・影響featureと無効化する旧wave |
| not_evaluated | member/権限/capacity、実参照、承認者本人性、鮮度、完了集約、全過去原本、scope非重複などの未確認事項 |

共有areaのdisjoint_scopes指定だけでは並列にしません。Issue未作成の機能も計画できますが、Issueを作成・選択・claimしません。
新テストは既存CIのNode22/24で実行します。Projectを含む共通Golden Testも利用できます。保存Project成果物の自動走査は対象外です。
上限と計算規則は`project-orchestration-design.md`第8.4節を参照してください。失敗時はcode/path/IDから人間が原因を確認し、データや承認を自動補完して通しません。
古い結果JSONを次回のpassとして使わず、元入力を再検査します。復旧できなければ元台帳を保持し、従来のIssue/assignee/着手コメント/branch/PRの手動運用へ戻します。

<a id="manual-coordinator"></a>

## 手動で担当割当・着手・引き継ぎを行う

[手動Coordinator運用](manual-coordinator.md)に、status mapping、担当確定、claim（着手記録）、heartbeat（明示的な進捗確認）、stale警告、解除・再割当・交代と部分失敗の復旧をまとめています。
[6種類のコメント様式](../../.ai-workflow/templates/project-manual/v1/README.md)を実Issueへコピーし、人間が確認して追記します。最初に[机上検証例](../examples/project-manual/walkthrough.md)を辿ってください。

1. 人間のCoordinatorが契約・承認・依存・担当条件・全量active claim・実scope競合を確認し、人間owner1人と引受を確定します。
2. claim準備、Issue branch、直前再確認、claim確定、status更新を順に行い、実状一致を読み戻した後に作業を始めます。
3. 中断・レビュー・staleでもclaimの枠は保持します。解除依頼だけで枠を空けず、旧作業停止・未push/引継を確認して人間Coordinatorが解除を確定します。
4. 部分失敗や不明点があれば新規割当を止め、同じ操作IDと現状を人間が照合します。旧記録を削除せず追記します。

任意導入です。様式v1は人間向けの版で、新schema・自動操作・原子的排他の仕組みではありません。既存の単一Issue運用も継続できます。
計画/member validatorのpassだけでは担当やclaimを確定しません。実GitHubと人間の確認が必要な範囲は次節も参照してください。

<a id="project-members"></a>

## 指定した人間の担当条件を検査する

member検査は「この人が、このIssueと領域を担当する条件を、提出した確認記録上で満たすか」を確認します。
役割・担当領域・repository権限・任意のOrganization Team・統合責任者・同時担当数を検査します。開発対象アプリ自身のテストや、GitHubへの実認証・担当設定を行うツールではありません。

Node.js 22以上を用意し、repository rootで次を実行します。既存依存だけを再利用し、新規の外部サービスやSecretsは不要です。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm run test:members --prefix tools/workflow-project
```

最後のコマンドは同梱の合成入力に対する専用テストです。実際の台帳は明示pathでlibraryへ渡します。以下は合成例を読む実行可能な例です。

```sh
node --input-type=module <<'NODE'
import { loadProjectMembers } from './tools/workflow-project/member-load.mjs';
import { checkProjectMembers } from './tools/workflow-project/members.mjs';
const dir = 'tests/workflow-members/fixtures/';
const input = loadProjectMembers(process.cwd(), {
  project: dir + 'project.json',
  team: dir + 'team.json',
  context: dir + 'context.json',
});
console.log(JSON.stringify(checkProjectMembers(input), null, 2));
NODE
```

実案件ではproject/teamのpathを承認済み台帳へ置換し、contextを一時的な確認snapshotとして用意します。項目の正本は`.ai-workflow/schemas/project-member-checks/v1/context.schema.json`、記入例は上のfixturesです。

1. 人間がGitHub等でメンバー・人間アカウント・権限・必要Teamを確認し、member_factsに結果とevidence参照を記録します。APIが使えない場合は人間の確認コメントを参照でき、それもなければunknownで停止します。
2. project/teamのrevisionと、`digest(canonical(parsedData))`で計算したproject_digest/team_digestを記録します。関数は既存`tools/workflow-rules/resolve.mjs`を使います。digest更新だけで承認や権限が得られるわけではありません。
3. observed_at、evaluated_at、freshness_limit_secondsを明示します。鮮度制限は最大24時間で、デフォルト値はありません。例は1時間です。評価時刻や元の事実の正しさ自体は呼出元が確認します。
4. principalに人間credentialのlogin、またはbotのloginとon_behalf_of・代理依頼の確認を記録します。request.human_ownerは責任を持つ人間1人です。botを人間のメンバーとして登録しません。
5. requestのcandidateは新規担当条件の検査、assigned_ownerは既に割り当てられた人間との一致検査です。後者にはassigneesと責任・依頼関係の確認参照が必要です。
6. active_claimsへproject全体のactive claimを投影し、全量確認できた場合だけclaims_inventory_status:completeとします。partial/unknownや空配列を「誰も担当していない」と推測しません。

同時担当数は既存active Issue数+新規1です。assigned_ownerで同じIssueの本人claimがあれば追加0、別人のclaimは停止します。candidateで同じIssueにclaimがあれば本人分でも再取得せず、人間へ戻します。
長時間経過・休止・blocked・inactiveでもclaim解放を確認するまではinventoryへ残します。検査は枠や担当を自動で消費・解放しません。

統合責任者は既定ownerと台帳の宣言を照合します。Issueだけで別の責任者を使う場合は、request.owner_overridesへIssue/work/area/loginと、そのareaのCoordinatorによるapprovalを記録します。
approval_typeはintegration_owner_override。対象外のIssue/area、二重指定、別の承認者、未来の承認は通しません。実承認や本人性の認証ではなく、申告された対応の検査です。

| 結果 | 意味 |
| :--- | :--- |
| status: pass / qualification: eligible | 今回の提出記録内で必要条件をすべて満たす。担当確定・claim開始・作業許可ではない |
| qualification: ineligible | 既知の権限不足・担当不一致・上限超過などがある |
| qualification: unknown | 確認不足、古いsnapshot、入力不正などがあり判断できない |
| capacity | active_count/additional_count/limit。計算不能ならnull |
| diagnostics | 安定code・kind・構造path・login/area ID。evidence本文や自由記述を転載しない |
| not_evaluated | GitHubや証拠の真正性、実時刻/全量の真正性、契約/ready-for-ai/工程承認、依存、実scope競合、原子的claim、実作業 |

失敗時は台帳と確認記録を保持し、診断から人間が修正・再確認します。古い出力をpassの証拠として再利用せず、元入力から再検査します。
既存の計画checkerと併用しても、自動的にIssueを選択・割当・着手しません。手動Coordinatorが契約・承認・現在の担当と競合を確認してください。
上限と計算規則はproject-orchestration-design第9.4節を参照します。最大1000member/200area/10000claimは直接API用fixtureで、file loaderには各file1 MiBの上限もあります。
CIはこの専用テストをNode22/24で実行します。Projectを含む共通Golden Testも利用できます。保存Projectの自動走査は対象外です。復旧できない場合も従来のIssue/assignee/着手コメント/branch/PR運用へ戻れます。

<a id="project-aggregate"></a>

## 複数Issueの進捗と不整合を読み取り専用で集約する

`aggregateProject`は確認snapshotとIssue内部の元入力から、担当・claim・branch・PR・工程とfeatureの状態をまとめます。
「GitHubは完了だが内部は未完」「二重claim」「古い確認」などを返します。GitHub APIの取得・状態更新・claim解放・次Issue推薦は行いません。
開発対象の言語に関係なくNode.js 22以上で使います。初回の依存導入後はオフラインで動きます。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm run test:aggregate --prefix tools/workflow-project
```

最後のコマンドは同梱合成テストで、保存Projectの自動検査ではありません。次は合成入力を明示して集約する実行例です。

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { loadProjectAggregate } from './tools/workflow-project/aggregate-load.mjs';
import { aggregateProject } from './tools/workflow-project/aggregate.mjs';
const root = process.cwd() + '/tests/workflow-aggregate/fixtures';
const paths = JSON.parse(readFileSync(root + '/paths.json', 'utf8'));
const input = loadProjectAggregate(root, paths);
console.log(JSON.stringify(aggregateProject(input), null, 2));
NODE
```

実案件では必要な対象を人間が取得・確認し、contextへ投影します。項目の正本は`.ai-workflow/schemas/project-aggregate/v1/context.schema.json`、記入例は上のfixturesです。
raw API response、Issue本文やログ全文を入れず、必要なIDと属性、確認時刻・根拠参照だけを記録します。

1. project/delivery-planの承認済み原本とrevision、`digest(canonical(parsedData))`を記録します。Issue参照のoptionalも含め、全対象の取得範囲を確認します。partial/unknownは完了や空きと推測しません。
2. observed_at/evaluated_at/freshness_limit_secondsを明示します。制限は最大24時間・暗黙defaultなし。各Issueにも観測時刻、実Issue更新時刻、sourceを記録します。時計・全量性の真正性は呼出元が確認します。
3. 実labels/assignees、人間owner1人、準備・完了・取消・reviewの確認、claim/branch/PR、未push/未完了操作を投影します。inventory_status:completeは各一覧を全量確認できた場合だけです。ready-for-aiはproject statusと別です。
4. released claimは解除approval（approval_type:claim_release、関係する人間Coordinator）、実解除時刻、旧停止・未push/引継確認の参照を持ちます。欠ければ枠を保持します。staleは警告であり自動解除しません。
5. workflow_mode:managedのIssueにはplan/state/context/ruleInput、必要なprevious/revisionPlansを明示指定します。既存checkWorkflowを再実行し、通常のresume停止とschema/履歴破損を区別します。legacyは内部stage未評価を明示し、人間の完了確認を内部checker成功と読み替えません。
6. feature_confirmationsには各featureのAC受け入れ確認と任意の取消判断を記録します。constraint_factsはfeature/0始まりindexで計画制約へ対応させ、成立時にevidenceを付けます。

| 出力 | 読み方 |
| :--- | :--- |
| status:pass | 提出snapshotの必要な整合確認が成立。作業・割当や承認の許可ではない |
| status:blocked | 不正・不足・古い確認・不整合・上限違反がある。診断から人間が確認する |
| issues[].observed_project_status | 元のGitHub labelから解決した値。黙って修正しない |
| reconciliation_status | consistent / blocked / unknown。業務上blockedでも記録が整合する場合はconsistentになり得る |
| workflow | 既存checkerで再生したwork status/current stage、resumeとappend-onlyの確認範囲。legacyや破損ではnull |
| features / counts | 必須/optional・依存・制約・人間受け入れを考慮した状態、一意な計画参照から再計算した件数 |
| checkpoint / new_event_count | 既確認event prefixと今回の追加数。再読込で進捗を二重加算しない。自動保存しない |
| diagnostics | 安定code・kind・構造path・既知ID・手動復旧先code。自由文やエラーstackを転載しない |
| not_evaluated | 実GitHub/時計/全量・証拠本人性、自然言語AC、権限/capacity、実scope競合、原子的claim、計画改訂監査、実作業等 |

診断のrecoveryは人間が次に確認する先です。自動操作の命令ではありません。

| recovery | 確認先 |
| :--- | :--- |
| review_input | schema・台帳・元snapshotの形式/上限を確認する |
| confirm_facts | 観測時刻・取得範囲・根拠・本人の確認を取り直す |
| reconcile | 手動Coordinatorのreconciliation様式へ実状と差分を追記する |
| claim_update | stale等の警告を確認し、claim-update様式で継続/保留を記録する |

feature完了には必須Issueが1件以上・全件完了、人間によるfeature ACの受け入れ、関連作業/未解消操作なしが必要です。
optionalの未着手だけでは必須完了を否定しませんが、optionalのactive claimや不整合を隠しません。依存の取消/unknownや空計画を完了と扱いません。
不整合のある行とその下流をready/completedへ昇格せず、確認できた元の状態は一覧へ残します。致命的形式/上限違反では安全な空結果にします。

### checkpointの再利用と復旧

初回は全量再計算します。返されたcheckpointを呼出元が確認・保存し、次回は`paths.checkpoint`へそのファイルを明示指定します。
Issue/workごとに前回のevent ID/digest列が現在履歴の完全prefixであることを検査し、同じsnapshotの再読込ではnew_event_countが0になります。
別Issueの同event IDは別として扱い、同Issueの重複や改変・短縮・順序変更は拒否します。未確認/不整合Issueのcheckpointを進めたり、欠損Issueを削除済みとみなしたりしません。
checkpointがあっても元入力からのchecker再実行は省略しません。checkpoint自体の真正性やevent以外の全履歴は保証しません。必要なapproval/validationの追記性にはworkflow.previousの原本を使います。
台帳revision/digestが変わった場合は暗黙変換せず停止し、元記録を保存したうえで、人間が承認済み計画に対するcheckpointなしの全量再集約を明示します。

失敗時は元snapshot/台帳/checkpointを保持し、[手動Coordinator](manual-coordinator.md)の照合記録へ戻ります。結果でGitHub/stateを書き換えず、古いpass結果の流用や承認の捏造はしません。
非対応・破損を解消できなければ新規割当を保留し、従来のIssue/assignee/着手コメント/branch/PRへ戻せます。
上限は第13.0節を参照してください。100Issueの直接API用fixtureと、loaderの各file1 MiBは独立した制限です。
専用テストは既存CIのNode22/24へ接続します。実GitHub自動取得やMarkdown parser、保存Project走査、Project全体Goldenは含みません。

<a id="project-recommend"></a>

## 安全な次作業を読み取り専用で提案する

`recommendNextWork`は、本人の既存作業を優先し、次に確認する1作業を返します。担当がなければ、未割当IssueからCoordinatorへ相談する候補を返します。
確認済みsnapshotを検査するNode.js 22以上のlibraryです。開発対象の言語には依存せず、依存導入後はオフラインで動きます。

```sh
npm ci --prefix tools/workflow-rules --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-check --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund
npm run test:recommend --prefix tools/workflow-project
```

最後は同梱テストの実行です。保存Projectの自動走査ではありません。合成例は次のように明示して読みます。

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { loadProjectRecommendation } from './tools/workflow-project/recommend-load.mjs';
import { recommendNextWork } from './tools/workflow-project/recommend.mjs';
import { recommendMessages } from './tools/workflow-project/recommend-messages.mjs';
const root = process.cwd() + '/tests/workflow-recommend/fixtures';
const paths = JSON.parse(readFileSync(root + '/paths.json', 'utf8'));
const result = recommendNextWork(loadProjectRecommendation(root, paths));
console.log(JSON.stringify(result, null, 2));
for (const diagnostic of result.diagnostics) console.log(recommendMessages[diagnostic.code]);
NODE
```

この合成例は`decision:coordinator_candidates`、`kind:ask_coordinator`を返します。Issue #1の取得・割当・claim・branch作成は行いません。
実案件では以下を人間または既存接続ツールが取得・確認し、根拠参照付きの入力へ投影します。Markdownコメントの自動解析や自然言語指示の解釈は行いません。

| 入力 | 記録するもの |
| :--- | :--- |
| project / deliveryPlan / team | 承認済みの静的台帳原本。全checkerへ同じ値を渡す |
| aggregate.context / workflows / checkpoint? | 前節の集約用確認snapshotと、managed Issueの元plan/state/context/ruleInput、必要なprevious/revisionPlans、任意checkpoint |
| planning.replan_decisions / previous? | 人間によるcontinue/pause/cancel判断、改訂検査に必要な過去のproject/deliveryPlan/context原本 |
| context | 推薦対象の人間・AI、本人/代理・権限・全量claim・最新指示・Issue補足確認 |

推薦contextの正本は[context schema](../../.ai-workflow/schemas/project-recommend/v1/context.schema.json)です。
project/plan/teamの各revisionと`digest(canonical(parsedData))`、repository、observed_at/evaluated_at/freshness_limit_seconds（1〜86400、暗黙defaultなし）を原本へ結び付けます。時刻とTTLはaggregate.contextと一致させ、teamの更新後に確認します。
`human_owner`は人間login1人、`agent_ref`は今回のAI識別子です。principal/member_factsは既存member検査の形式を使い、役割名から実repository permissionや必要Teamを推測しません。AI/bot記録者は同じagent_refと人間のon_behalf_ofを持ちます。

`claims_inventory_status:complete`と`active_claims`はProject全体の確認です。集約中の未解除claimとID/Issue/work/ownerを照合し、計画外claimも無視しません。準備中・不明なclaimがある場合も存在を隠さず照合し、推薦を停止します。準備記録を確定claimへ昇格する処理はありません。stale/pause/review/inactiveや解除依頼だけで枠を空けません。
`instruction`は呼出元が確認した人間の最新指示をproceed/stop/pause/replan_requiredと根拠に正規化します。停止や計画変更の要求で提案を止めます。自然文から新priorityを作りません。
`requested_issue_ref`を指定するとその実Issueだけを評価します。条件不足でも別Issueへ移らず、指定だけで担当や承認は成立しません。

各計画Issueに一意の`issue_facts`を記録します。登録feature内のarea_ids、area内の安全な相対file_scope/non_scope、契約のacceptance/non_scope、現在工程のapproval、責任引受、Issue限定owner_overrides、scope_check、execution_confirmationを持ちます。
確認はconfirmed/denied/unknownとevidenceで表し、scope_checkはclear/conflict/unknownです。完了済み・他人担当に不要な確認をconfirmedへ補いません。
既存claimの実行依頼にはclaim_id・agent_ref・根拠を一致させ、必要な引継ぎを確認します。同じ人間の別AIのclaimを自由取得しません。

### 提案の順序と結果

既存aggregateProject→checkProjectPlan→対象ごとのcheckProjectMembers→既存claimのcheckWorkflowを元入力で再実行します。保存済みpass/eligibleや前回推薦を許可の根拠にしません。
集約blockedは全体停止です。本人の進行中claim→割当済みIssue→本人の阻害・レビュー・未確定操作の待機→未割当Coordinator候補の順に扱います。最上位が止まったら下位のIssueへ移りません。
候補順は承認済みpriority昇順→既存checkerのwave昇順→実Issue番号の数値昇順→feature/workのASCII順です。active featureで未計算のwaveはnullとし、同priorityの番号付きwaveの後へ置きます。nullを着手許可へ読み替えません。

| decision | 次に人間が確認すること |
| :--- | :--- |
| resume | 元Issue checkerが全体passかつcandidateとして返した次工程を、実行直前に再確認する |
| claim_request | 割当済みmanaged Issueの着手・claim/branch確定を既存の手動手順で確認する |
| coordinator_candidates | 上位1〜10候補から先頭Issueの担当割当をCoordinatorへ相談する |
| wait | 人間指示・古いclaim・レビュー・既存checkerの停止・legacyの工程確認などを解消する |
| blocked | 不明・不足・不整合・古いsnapshot・上限を診断から確認する |
| none | 確認済みの準備状況や適格性から、現在提案できる対象がない |

`status:pass`は入力に基づく結果、`pass+wait`は通常の待機です。推薦の自動実行や承認ではありません。
`current_work`は待機中の対象・工程・claim、`selected_action`は最大1件、`coordinator_candidates`は相談候補、`excluded`は対象ごとの除外codeです。`diagnostics.source/source_code`は既存checkerの停止理由を示します。日本語説明はrecommend-messages.mjsへ集約しています。
実行中stage、承認待ち、unsafe retry、過去原本不足を推薦側で緩和せず、next_stageを推測しません。legacyの既存/割当済みはmanual_reviewへ戻し、未割当は必要確認が揃えば相談候補にできます。従来の手動開発は継続できます。

全依存completed・全constraint satisfied、feature自体の停止/終了と人間のpause/cancel判断、本人/代理・実権限・所有・同時担当を再確認します。既存自己claimは追加0、新規は+1です。
他の未解除claim/open PRとfeature/area pathが同一・祖先子孫で重なれば保守的に除外し、disjoint_scopes、同wave、clearの申告だけで解除しません。本人の同claim/branchのみ自己競合から除外します。

### 上限・保証範囲と復旧

loaderは列挙したpathだけを読み、元ファイルと入力を変更しません。paths.aggregate.workflowsは各Issueのissue_ref/plan/state/context/ruleInputと任意previous/revisionPlansを列挙します。planning.previousも3原本のpathを列挙します。参照先は自動取得しません。
全入力5 MiB（previous等も合算）、各file1 MiB、深さ32/200000node、100Issue/workflow、feature1000/area200/member・fact1000/active_claim10000、scope・参照等の各合計10000、既存の履歴上限を維持します。明示file数は最大10620、累計読込byteも5 MiBです。
診断と除外理由は計1000件、結果1 MiB、途中のbyte予算も制限します。超過時は候補と選択を空にして停止します。直接APIの100Issue合成fixtureでcold10秒以内を目標に測定し、file上限とは独立に確認します。

`not_evaluated`には実GitHub・本人/権限/証拠/全量/時刻の真正性、自然言語AC/指示、実ファイル競合/未pushの全証明、原子的claim、snapshot後の変更、実作業を残します。snapshotの申告だけで実認証や排他は成立しません。
人間確認が必要な相談/claim依頼を自動実行せず、resumeも既存承認を超える権限を作りません。全提案で実Issue/担当/依頼/claim/branch/PR/未push/承認/競合を実行前に再確認します。
未知version・破損・不整合を解消できなければ元台帳/snapshot/履歴を保持し、[手動Coordinator](manual-coordinator.md)の照合へ戻します。修復・自動解放・再割当・共有state更新は行いません。
専用テストはCIのNode22/24で動きます。Projectを含む共通Golden Testも利用できます。保存Project走査・実GitHub連携・Projects/Dispatcher/Runnerは別の後続対応です。

<a id="project-golden"></a>

## Projectの統合Golden Test

計画・担当/権限・集約・推薦を、固定した運用例と照合するテストも同じGoldenハーネスで実行します。
既存12caseに25 Project caseを追加した37caseが対象です。入力・期待見本・禁止条件、設計14観点との対応・未検証範囲は[固定例の説明](../examples/project-golden/README.md)を参照してください。

| adapter | 直接実行する既存API |
| :--- | :--- |
| project_plan | checkProjectPlan |
| project_members | checkProjectMembers |
| project_aggregate | aggregateProject |
| project_recommend | recommendNextWork |

各APIのresult schemaを検証し、出力全文を固定見本へ比較します。status/診断のsignalsと独立した重要値・禁止条件も確認します。
同じcase内の共通台帳・確認snapshot・member facts・全量claim・対象Issueを照合し、推薦は元入力から既存checkerを再実行します。
入力の欠落・差分・例外・禁止結果は失敗、想定blocked/waitはテストとしてpassedです。未選択adapterはnot_evaluatedのままです。

既存のGolden実行命令とWorkflow ValidationのNode22/24が新caseも実行します。新job・権限やGitHub操作は追加していません。
Golden利用時は既存workflow-projectの依存も導入します。対象アプリの言語や本番runtimeを変更する必要はありません。
見本の手動更新・失敗時の復旧と上限は既存Golden Test節のままです。既存12caseの見本・比較規則は維持し、normalizeへ安全上のfieldを追加しません。

2要求は相談→人間が1 ownerを確定した後の他方除外→二重active拒否という固定snapshotで確認します。原子的な排他やライブ同時操作は未実装です。
Dispatcher停止も実障害を発生させず、人間pauseと実状確認後の手動Issues-only復帰を検証します。実GitHub/本人/証拠/権限の真正性・実scope/未push/引継・実作業は保証しません。
失敗時は元記録を保存して個別checkerと手動Coordinatorへ戻し、実データを自動修正しません。CI成功はRelease承認ではありません。
