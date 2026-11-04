import test from'node:test';import assert from'node:assert/strict';import{executeProcess}from'../../tools/workflow-security/process.mjs';
test('database validator rejects empty, malformed and traversal archives without any network',async()=>{const code=`import importlib.util,tempfile,pathlib,zipfile,json
spec=importlib.util.spec_from_file_location('acq','tools/workflow-security/acquire.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 for name,entries in [('empty',{}),('bad',{'x.json':'invalid'}),('escape',{'../x.json':'{}'})]:
  p=pathlib.Path(d)/(name+'.zip')
  with zipfile.ZipFile(p,'w') as z:
   for k,v in entries.items():z.writestr(k,v)
  try:m.inspect_database(p);raise AssertionError('invalid database accepted')
  except ValueError:pass
 p=pathlib.Path(d)/'valid.zip'
 with zipfile.ZipFile(p,'w') as z:z.writestr('OSV-fixture.json',json.dumps({'id':'OSV-fixture','modified':'2026-11-04T00:00:00Z','affected':[]}))
 assert m.inspect_database(p)['advisories']==1
 m.MAX_ENTRIES=0
 try:m.inspect_database(p);raise AssertionError('entry limit accepted')
 except ValueError as error:assert str(error)=='database_entry_limit'
 m.MAX_ENTRIES=100000;m.MAX_EXPANDED=0
 try:m.inspect_database(p);raise AssertionError('expanded limit accepted')
 except ValueError as error:assert str(error)=='database_expanded_limit'
print('database_limits_pass')`;
 const r=await executeProcess('python3',['-c',code],{cwd:new URL('../../',import.meta.url)});assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim(),'database_limits_pass');});
