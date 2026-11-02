# 隔離したv2導入・段階移行の確認例

実装確認の基準はPR #41マージ後のmain、v1参照は`v1.0.0`です。
これは一時コピーと合成入力による再現例です。実案件への移行・承認・担当割当は行いません。
[試用前の確認表](../../common/v2-adoption-checklist.md)と[移行ガイド](../../common/migration-v1-to-v2.md)を併読してください。

## 1. 元commitを固定して展開する

前提はLinux、Bash、Git、tar、Python 3、Node.js 22以上、npmです。確認環境はNode.js 24.19.0 / npm 11.9.0でした。
取得時にはrepositoryへの読み取り権限とnpmへの接続が必要です。検査自体はオフラインです。npm cacheも一時確認先へ分離します。
以下のBashブロックは同じshellで順に実行します。元repositoryのrootから開始してください。

```bash
set -euo pipefail
issue42_repo=$(git rev-parse --show-toplevel)
issue42_v2_commit=ec00ebd1bf750c47a5533f0fc571b86abff6c022
issue42_v1_commit=f343151ef62cdc1d5ec3fe0cb2d3cfea7d4a0921
git -C "$issue42_repo" fetch --no-tags origin refs/tags/v1.0.0
test "$(git -C "$issue42_repo" rev-parse FETCH_HEAD)" = "$issue42_v1_commit"
git -C "$issue42_repo" cat-file -e "$issue42_v2_commit^{commit}"
issue42_dir=$(mktemp -d /tmp/v2-adoption.XXXXXXXX)
issue42_fresh="$issue42_dir/fresh"
mkdir "$issue42_fresh" "$issue42_dir/v1-reference" "$issue42_dir/v1-project"
git -C "$issue42_repo" archive "$issue42_v2_commit" > "$issue42_dir/v2.tar"
git -C "$issue42_repo" archive "$issue42_v1_commit" > "$issue42_dir/v1.tar"
tar -xf "$issue42_dir/v2.tar" -C "$issue42_fresh"
tar -xf "$issue42_dir/v1.tar" -C "$issue42_dir/v1-reference"
tar -xf "$issue42_dir/v1.tar" -C "$issue42_dir/v1-project"
printf '一時確認先: %s\n' "$issue42_dir"
```

`--no-tags`のfetchは参照用で、tagを作成・更新しません。上記commitは確認時点の固定値です。
実導入では採用するcommitを別途レビューし、同じcommitの隠しdirectory・tool・schema・共通規約・tests/fixture・lockfileを揃えます。
個別toolだけを別versionから混ぜたり、node_modulesを引き継いだりしません。

## 2. 新規導入と単一Issue・任意Projectを試す

検査したい範囲で依存導入数が異なります。

| 範囲 | 依存を導入するpackage |
| :--- | :--- |
| 文書中心の従来運用 | Node.jsの導入は不要 |
| この例のrules/check段階移行 | rules / checkの2つ |
| 同梱Goldenのみ | rules / check / trace / golden / projectの5つ |
| CIと同じ全回帰 | 上記5つとschema / ciの計7つ |

GoldenにはProject用25caseも同梱します。Projectの依存を入れることと、利用先にProject台帳を採用することは別です。
次は全7packageを導入する例です。最小Goldenを試す場合はschemaとciをループから外します。

```bash
cd "$issue42_fresh"
for issue42_package in rules check trace golden project schema ci; do
  npm ci --prefix "tools/workflow-$issue42_package" --cache "$issue42_dir/npm-cache" --ignore-scripts --no-audit --no-fund
done
node tools/workflow-golden/run.mjs --json > "$issue42_dir/golden.json"
node tools/workflow-ci/validate.mjs --json > "$issue42_dir/ci.json"
```

最小Goldenの場合は最後のworkflow-ciコマンドを省きます。想定結果はGoldenが37caseすべて`passed`、CI検査が保存Issue成果物0件で`pass`です。
0件は実Issueの検証成功を意味しません。専用テスト計1267件の実行コマンドと内訳は[確認表](../../common/v2-adoption-checklist.md)を参照してください。

単一Issueと任意Projectの合成入力は明示して読みます。このブロックは上記の7package導入後、または最小Goldenの5package導入後に実行できます。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorkflow } from './tools/workflow-check/check.mjs';
import { loadProjectRecommendation } from './tools/workflow-project/recommend-load.mjs';
import { recommendNextWork } from './tools/workflow-project/recommend.mjs';
const input = JSON.parse(readFileSync('tests/workflow-golden/fixtures/low-docs/input/workflow.yaml', 'utf8'));
assert.equal(Object.hasOwn(input.plan, 'project_id'), false);
const single = checkWorkflow(input);
assert.equal(single.status, 'pass');
assert.equal(single.next_stage, 'intake');
const root = process.cwd() + '/tests/workflow-recommend/fixtures';
const paths = JSON.parse(readFileSync(root + '/paths.json', 'utf8'));
const recommendation = recommendNextWork(loadProjectRecommendation(root, paths));
assert.equal(recommendation.status, 'pass');
assert.equal(recommendation.decision, 'coordinator_candidates');
assert.equal(recommendation.selected_action.kind, 'ask_coordinator');
console.log(JSON.stringify({single: {status: single.status, next_stage: single.next_stage},
  recommendation: {status: recommendation.status, decision: recommendation.decision, action: recommendation.selected_action.kind}}));
NODE
```

`intake`は次に確認する工程です。`ask_coordinator`は担当の相談候補で、Issue取得・claim・branch作成は実行しません。
fixture内のURL・本人・承認・時刻は合成です。計画/member/集約を個別に試す入口は[検査ツールの利用詳細](../../common/workflow-tools-guide.md)を参照してください。

## 3. v1と利用先独自変更を保持して段階導入する

次はv1コピーに独自変更を加え、元のv1参照・backupと保持対象5fileのhashを記録します。
実案件でAGENTSや規約を無条件に上書きする操作へ置き換えないでください。

```bash
cd "$issue42_dir/v1-project"
printf '\n<!-- SYNTHETIC_LOCAL_RULE_KEEP -->\n' >> AGENTS.md
mkdir -p app
printf 'synthetic application content\n' > app/local.txt
printf '# Synthetic local policy\n' > docs/project-notes.md
printf '# Synthetic handoff\nowner: example-owner\nconfirmation: pending\n' > docs/existing-work.md
cp -a "$issue42_dir/v1-project" "$issue42_dir/v1-project-backup"
sha256sum AGENTS.md docs/common/development-rules.md app/local.txt docs/project-notes.md docs/existing-work.md > "$issue42_dir/protected.sha256"
python - "$issue42_dir" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
def manifest(name):
    base = root / name
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(base.rglob('*')) if p.is_file()}
data = {name: manifest(name) for name in ['v1-reference', 'v1-project-backup']}
(root / 'preserved.json').write_text(json.dumps(data, sort_keys=True))
PY
```

この合成v1には次の6pathが存在しないことを確認してから追加します。既存pathがある実案件では停止し、差分を人間がレビューします。
AGENTS/共通規約は保持し、legacyルールがその原本を参照します。この段階ではtrace/Project/CIは導入しません。

```bash
issue42_paths=(tools/workflow-rules tools/workflow-check docs/common/rules .ai-workflow/schemas/issue .ai-workflow/schemas/rules .ai-workflow/schemas/checks)
for issue42_path in "${issue42_paths[@]}"; do
  test ! -e "$issue42_path"
  test ! -L "$issue42_path"
done
git -C "$issue42_repo" archive "$issue42_v2_commit" -- "${issue42_paths[@]}" > "$issue42_dir/modules.tar"
tar -xf "$issue42_dir/modules.tar"
for issue42_package in rules check; do
  npm ci --prefix "tools/workflow-$issue42_package" --cache "$issue42_dir/npm-cache" --ignore-scripts --no-audit --no-fund
done
```

## 4. 非対応・不足で停止し、手動確認へ戻る

保持した規約でルールを再解決し、合成planへ反映して検査します。他のrepositoryで得たpassやdigestを承認として流用しません。
次のversion999・context欠落は一時コピーだけで作ります。検査で入力が書き換わらず、次工程を返さず停止することを確認します。

```bash
node --input-type=module - "$issue42_fresh" <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRules } from './tools/workflow-rules/load.mjs';
import { resolveRules } from './tools/workflow-rules/resolve.mjs';
import { projectPlan } from './tools/workflow-rules/plan.mjs';
import { checkWorkflow } from './tools/workflow-check/check.mjs';
const ruleInput = {...loadRules(process.cwd()),
  context: {schema_version: 1, risk: 'low', areas: [], technologies: [], data_types: []}, optIns: []};
for (const path of ['AGENTS.md', 'docs/common/development-rules.md']) assert.ok(ruleInput.sourceDigests[path]);
const resolution = resolveRules(ruleInput);
assert.equal(resolution.status, 'pass');
const valid = JSON.parse(readFileSync(process.argv[2] + '/tests/workflow-golden/fixtures/low-docs/input/workflow.yaml', 'utf8'));
valid.ruleInput = ruleInput;
valid.plan = projectPlan(valid.plan, resolution, ruleInput);
const badVersion = structuredClone(valid);
badVersion.plan.schema_version = 999;
const missing = structuredClone(valid);
delete missing.context;
mkdirSync('adoption-evidence');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const [name, input] of Object.entries({valid, 'bad-version': badVersion, 'missing-context': missing})) {
  const path = `adoption-evidence/${name}.json`;
  writeFileSync(path, JSON.stringify(input, null, 2));
  const before = hash(path);
  const result = checkWorkflow(JSON.parse(readFileSync(path, 'utf8')));
  assert.equal(hash(path), before);
  assert.equal(result.status, name === 'valid' ? 'pass' : 'blocked');
  assert.equal(result.next_stage, name === 'valid' ? 'intake' : null);
  if (name !== 'valid') assert.ok(result.diagnostics.some(d => d.code === 'schema_invalid'));
  console.log(JSON.stringify({name, status: result.status, next_stage: result.next_stage}));
}
writeFileSync('adoption-evidence/manual-handoff.md',
  '# Synthetic fallback / human confirmation pending\n' +
  'Preserve original inputs, v1 backup and local policies. Stop automatic retry/new assignment.\n' +
  'Human must reconcile Issue, owner/claim, branch/PR, unpushed work, approvals and last verified boundary.\n');
NODE
sha256sum -c "$issue42_dir/protected.sha256"
python - "$issue42_dir" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
for name, expected in json.loads((root / 'preserved.json').read_text()).items():
    base = root / name
    actual = {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(base.rglob('*')) if p.is_file()}
    assert actual == expected, name
print('v1 reference and customized backup unchanged')
PY
```

想定結果は正常例が`pass/intake`、2つの停止例が`blocked/next_stage:null`・`schema_invalid`、保持5file・v1参照19file・backupが不変です。
元入力とbackupを保持して引継記録を作るところまでが、この合成/机上確認の範囲です。

実案件で停止したら自動再試行・新規割当を保留し、元成果物、最後に確認できたcommit、Issue/PR、未push作業を残します。
人間が担当・claim・現在地・承認・競合を照合し、復元できない承認は再承認を得て、従来のIssue運用で継続するか修復するか判断します。
v2成果物や履歴を削除して完了扱いにしません。利用先規約の意味の整合、実移行・実復旧・同時操作の排他は未検証です。

## 確認結果と次の判断

基準commitでの隔離全回帰1267件、固定Golden37case、別コピーでの最小Golden5packageを確認済みです。
単一Issue、計画/member/集約/推薦の明示入力例と、上記のv1保持・停止も確認済みです。詳細な実行記録と文書変更後の実CIは[Issue #42](https://github.com/gorillaimo/ai-driven-dev-template/issues/42)と対応PRに残します。

実本人・権限・証拠・承認の確認、実案件への採用、他OS、実障害の復旧と原子的claimはこの例で保証しません。
人間がマニュアルの使いやすさと残る条件を見直してから、試用範囲・将来のRelease可否を別途判断します。VERSIONは開発版のままです。
