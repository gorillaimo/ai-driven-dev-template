import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveRules, validateArtifact } from '../../tools/workflow-rules/resolve.mjs';
const approval = { approval_type: 'opt-in', approved_by: 'example-user', reference: {kind:'url',target:'https://github.com/example/project/issues/1#issuecomment-1'}, approved_at:'2026-10-22T00:00:00Z' };
export const rule = (id, extra={}) => ({schema_version:1,rule_id:id,version:'1.0.0',level:'always-on',category:['testing'],applies_when:[],requires:[],conflicts_with:[],after:[],severity:'block',purpose:'Synthetic test',inputs:[],expected_outputs:['review'],on_failure:'Stop for review',approval_required:false,body_refs:[{kind:'file',target:'docs/common/rules/'+id+'/rule.md'}],...extra});
export const legacy = () => rule('legacy',{body_refs:[{kind:'file',target:'AGENTS.md'},{kind:'file',target:'docs/common/development-rules.md'}]});
export const context = {schema_version:1,risk:'low',areas:[],technologies:[],data_types:[]};
const run = (rs=[], ctx=context, optIns=[]) => resolveRules({rules:[legacy(),...rs],context:ctx,optIns});
const code = (result, expected) => assert.ok(result.diagnostics.some(d=>d.code===expected),JSON.stringify(result));
test('legacy and deterministic ordering; input remains unchanged',()=>{
 const input={rules:[rule('z'),legacy(),rule('a')],context,optIns:[]}; const before=structuredClone(input);
 const out=resolveRules(input);assert.equal(out.status,'pass');assert.deepEqual(out.order,['a','legacy','z']);assert.deepEqual(input,before);
 assert.deepEqual(resolveRules({...input,rules:[...input.rules].reverse()}),out);
 assert.equal(validateArtifact('resolution',out).valid,true);
});
test('conditional AND, known empty, false dominates unknown',()=>{
 const r=rule('api',{level:'conditional',applies_when:[{fact:'areas',any_of:['api']},{fact:'risk',any_of:['high']}]});
 assert.equal(run([r]).rules.find(x=>x.rule_id==='api').status,'not_applicable');
 assert.equal(run([r],{schema_version:1,areas:[]}).status,'pass');
 code(run([r],{schema_version:1,risk:'high'}),'unknown_condition');
 assert.deepEqual(run([r],{...context,risk:'high',areas:['api']}).order,['legacy','api']);
});
test('explicit opt-in and approval required',()=>{
 const r=rule('extra',{level:'opt-in'}); assert.deepEqual(run([r]).order,['legacy']);
 code(run([r],context,[{rule_id:'extra',version:'1.0.0'}]),'invalid_opt_in');
 assert.deepEqual(run([r],context,[{rule_id:'extra',version:'1.0.0',approval}]).order,['legacy','extra']);
 code(run([r],context,[{rule_id:'extra',version:'2.0.0',approval}]),'dependency_version');
 code(run([],context,[{rule_id:'missing',version:'1.0.0',approval}]),'unknown_rule');
});
for (const [name,rs,expected] of [
 ['missing dependency',[rule('a',{requires:[{rule_id:'missing',version:'1.0.0'}]})],'unknown_rule'],
 ['unselected dependency',[rule('a',{requires:[{rule_id:'b',version:'1.0.0'}]}),rule('b',{level:'opt-in'})],'dependency_not_selected'],
 ['version mismatch',[rule('a',{requires:[{rule_id:'legacy',version:'2.0.0'}]})],'dependency_version'],
 ['one sided conflict',[rule('a',{conflicts_with:['legacy']})],'rule_conflict'],
 ['duplicate',[rule('a'),rule('a')],'duplicate_rule'],
 ['cycle',[rule('a',{after:['b']}),rule('b',{requires:[{rule_id:'a',version:'1.0.0'}]})],'cycle'],
 ['unselected cycle',[rule('a',{level:'opt-in',after:['a']})],'cycle'],
 ['unknown condition',[rule('a',{level:'opt-in',applies_when:[{fact:'unknown',any_of:['x']}]})],'invalid_rule'],
 ['unknown field',[rule('a',{typo:true})],'invalid_rule'],
 ['invalid version',[rule('a',{version:'latest'})],'invalid_rule'],
 ['conditional empty',[rule('a',{level:'conditional'})],'invalid_rule'],
 ['always-on condition',[rule('a',{applies_when:[{fact:'risk',any_of:['high']}]})],'invalid_rule'],
]) test(name,()=>{const out=run(rs);assert.equal(out.status,'blocked');assert.deepEqual(out.order,[]);code(out,expected);});
test('dependency order beats tie-break without overriding authority',()=>assert.deepEqual(run([rule('a',{after:['z']}),rule('z')]).order,['legacy','z','a']));
test('legacy cannot be absent, optional, overridden or lose either source',()=>{
 for(const rules of [[],[rule('legacy')],[legacy(),legacy()],[legacy(),rule('x',{level:'opt-in',conflicts_with:['legacy']})].slice(0,1).map(r=>({...r,level:'opt-in'}))]) assert.equal(resolveRules({rules,context,optIns:[]}).status,'blocked');
});
test('warn does not weaken a conflict; dependent of conflict is blocked',()=>{
 const out=run([rule('a',{severity:'warn',conflicts_with:['legacy']}),rule('b',{requires:[{rule_id:'a',version:'1.0.0'}]})]);
 code(out,'rule_conflict');assert.equal(out.rules.find(r=>r.rule_id==='b').status,'conflicted');
});
test('unknown schema/context and invalid risk are blocked',()=>{for(const ctx of [{...context,schema_version:2},{...context,risk:'extreme'},{...context,typo:1}]) code(run([],ctx),'invalid_context');});
test('100 rules / 500 edges within five seconds',()=>{
 const rs=Array.from({length:100},(_,i)=>rule('r-'+String(i).padStart(3,'0'),{after:Array.from({length:Math.min(i,5)},(_,j)=>'r-'+String(i-j-1).padStart(3,'0'))}));
 // 485 edges plus 15 non-adjacent edges = 500.
 for(let i=10;i<25;i++) rs[i].after.push('r-000');
 assert.equal(rs.reduce((n,r)=>n+r.after.length,0),500);
 const start=performance.now();assert.equal(run(rs).status,'pass');const elapsed=performance.now()-start;
 assert.ok(elapsed<5000);console.log('100 rules / 500 edges: '+elapsed.toFixed(2)+'ms');
});
test('case manifest covers context facts with stable expected decisions',async()=>{
 const {readFileSync}=await import('node:fs');const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 for(const c of cases){const result=run([rule('example',c.rule)],{schema_version:1,...c.context});assert.equal(result.rules.find(r=>r.rule_id==='example').status,c.status,c.id);}
});
test('SemVer and metadata boundaries',()=>{
 for(const version of ['1.0.0-01','01.0.0','v1.0.0','1.0','1.0.0-']) code(run([rule('example',{version})]),'invalid_rule');
 for(const version of ['0.0.0','1.0.0-alpha.1','1.0.0+build.1']) assert.equal(run([rule('example',{version})]).status,'pass');
 for(const extra of [{applies_when:[{fact:'risk',any_of:[]}]},{rule_id:'A'},{body_refs:[{kind:'url',target:'https://example.com'}]},{schema_version:2}]) code(run([rule('example',extra)]),'invalid_rule');
});
test('missing after/conflict IDs and unknown condition operators fail even when inactive',()=>{
 for(const extra of [{after:['missing']},{conflicts_with:['missing']},{applies_when:[{fact:'risk',any_of:['high'],operator:'execute'}]}]) assert.equal(run([rule('example',{level:'opt-in',...extra})]).status,'blocked');
});
test('opt-in conditions and duplicate adoption cannot silently activate rules',()=>{
 const r=rule('example',{level:'opt-in',applies_when:[{fact:'areas',any_of:['api']}]});const opt={rule_id:'example',version:'1.0.0',approval};
 assert.equal(run([r],context,[opt]).rules.find(r=>r.rule_id==='example').status,'not_applicable');
 code(run([r],{schema_version:1},[opt]),'unknown_condition');code(run([r],context,[opt,opt]),'invalid_opt_in');
});
test('invalid source maps are blocked, never projected as external references',()=>{
 for(const extra of [{sourceDigests:{'../secret':'0'.repeat(64)}},{ruleSources:{legacy:'https://example.com'}}]){const result=resolveRules({rules:[legacy()],context,...extra});code(result,'invalid_sources');assert.equal(result.status,'blocked');}
});
