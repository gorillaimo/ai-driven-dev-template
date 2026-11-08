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
 except ValueError as error:
  assert str(error)=='database_entry_limit'
  assert error.counts['database_entries']==1
  assert error.counts['database_expanded_bytes']>0
  assert set(error.counts)=={'database_entries','database_expanded_bytes','database_compressed_bytes'}
 m.MAX_ENTRIES=500000;m.MAX_EXPANDED=0
 try:m.inspect_database(p);raise AssertionError('expanded limit accepted')
 except ValueError as error:assert str(error)=='database_expanded_limit'
print('database_limits_pass')`;
 const r=await executeProcess('python3',['-c',code],{cwd:new URL('../../',import.meta.url)});assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim(),'database_limits_pass');});
test('public database allows 500000 entries and still rejects excess count or expanded bytes',async()=>{const code=`import importlib.util
spec=importlib.util.spec_from_file_location('acq','tools/workflow-security/acquire.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.MAX_ENTRIES==500000
assert m.MAX_DB==1024*1024*1024
assert m.MAX_EXPANDED==2*1024*1024*1024
m.validate_database_totals({'database_entries':500000,'database_expanded_bytes':m.MAX_EXPANDED,'database_compressed_bytes':m.MAX_DB})
for entries,expanded,expected in [(500001,1,'database_entry_limit'),(500000,m.MAX_EXPANDED+1,'database_expanded_limit')]:
 counts={'database_entries':entries,'database_expanded_bytes':expanded,'database_compressed_bytes':1}
 try:m.validate_database_totals(counts);raise AssertionError('over-limit database accepted')
 except m.DatabaseLimitError as error:assert str(error)==expected and error.counts==counts
print('database_boundary_pass')`;
 const r=await executeProcess('python3',['-c',code],{cwd:new URL('../../',import.meta.url)});assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim(),'database_boundary_pass');});

const timingPrelude=`import importlib.util,contextlib,io,json,tempfile,pathlib,tarfile,zipfile,hashlib,subprocess,os,sys
spec=importlib.util.spec_from_file_location('acq','tools/workflow-security/acquire.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def report(t):
 out=io.StringIO()
 with contextlib.redirect_stderr(out):t.emit();t.emit()
 lines=out.getvalue().splitlines();assert len(lines)==1 and len(out.getvalue().encode())<=16384
 return json.loads(lines[0])
`;
async function timingCheck(code){const r=await executeProcess('python3',['-c',timingPrelude+code],{cwd:new URL('../../',import.meta.url)});assert.equal(r.code,0,r.stderr);}

test('preparation timing preserves exceptions and distinguishes measured, failed and unmeasured phases',async()=>timingCheck(`
ticks=iter([1000000,3500000,4000000,4000001,5000000,8000000])
t=m.PreparationTiming(True,lambda:next(ticks))
with t.measure('gitleaks_download'):pass
with t.measure('osv_checksum'):pass
original=ValueError('credential-secret-in-exception')
try:
 with t.measure('trivy_extract'):raise original
except ValueError as error:assert error is original
r=report(t)
assert r=={'format_version':1,'artifact_kind':'security-preparation-timing','stages':[
 {'stage_id':'gitleaks_download','status':'completed','duration_ms':2},
 {'stage_id':'osv_checksum','status':'completed','duration_ms':0},
 {'stage_id':'trivy_extract','status':'failed','duration_ms':3}],'truncated':False}
for values in [(2,1),(0,600001000000),(True,2),(None,2),('secret-clock',2)]:
 ticks=iter(values);t=m.PreparationTiming(True,lambda:next(ticks))
 with t.measure('npm_database_validation'):pass
 assert report(t)['stages']==[{'stage_id':'npm_database_validation','status':'not_evaluated','duration_ms':None}]
def broken():raise RuntimeError('secret-clock')
t=m.PreparationTiming(True,broken)
with t.measure('npm_database_download'):pass
assert report(t)['stages'][0]['duration_ms'] is None
try:
 with t.measure('osv_download'):raise original
except ValueError as error:assert error is original
`));

test('preparation timing is opt-in, bounded, sanitized and tolerates output failure',async()=>timingCheck(`
def forbidden():raise AssertionError('disabled clock called')
t=m.PreparationTiming(False,forbidden)
with t.measure('gitleaks_download'):pass
out=io.StringIO()
with contextlib.redirect_stderr(out):t.emit()
assert out.getvalue()=='' and t.stages==[]
t=m.PreparationTiming(True,lambda:0)
with t.measure('https://secret.invalid/private/path?token=credential'):pass
r=report(t);assert r['stages']==[{'stage_id':'unknown','status':'not_evaluated','duration_ms':None}]
t=m.PreparationTiming(True,lambda:0)
for _ in range(33):
 with t.measure('PyPI_database_download'):pass
r=report(t);assert len(r['stages'])==32 and r['truncated'] is True
class BrokenOutput:
 def write(self,value):raise OSError('secret-output')
 def flush(self):raise OSError('secret-output')
t=m.PreparationTiming(True,lambda:0)
with t.measure('Pub_database_validation'):pass
with contextlib.redirect_stderr(BrokenOutput()):t.emit()
`));

test('preparation timing retains CLI stdout and exit status for unset, unknown and enabled flags',async()=>timingCheck(`
expected={'status':'error','code':'arguments_invalid','stage':'arguments','tool_id':None,'http_status':None}
for flag in [None,'0','true','credential-env','1']:
 env=dict(os.environ);env.pop('WORKFLOW_SECURITY_TIMING',None)
 if flag is not None:env['WORKFLOW_SECURITY_TIMING']=flag
 r=subprocess.run([sys.executable,'tools/workflow-security/acquire.py'],capture_output=True,text=True,env=env)
 assert r.returncode==1 and json.loads(r.stdout)==expected
 if flag=='1':assert json.loads(r.stderr)=={'format_version':1,'artifact_kind':'security-preparation-timing','stages':[],'truncated':False}
 else:assert r.stderr==''
`));

const syntheticAcquisition=`
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);m.ROOT=root
 payloads={};tools=[]
 for name in ['gitleaks','osv','trivy']:
  binary=(name+'-inert-fixture').encode();data=binary
  if name!='osv':
   stream=io.BytesIO()
   with tarfile.open(fileobj=stream,mode='w:gz') as archive:
    member=tarfile.TarInfo(name);member.size=len(binary);archive.addfile(member,io.BytesIO(binary))
   data=stream.getvalue()
  url='https://fixture.invalid/'+name;payloads[url]=data
  tools.append({'tool_id':name,'binary':name,'url':url,'version':'fixture','sha256':hashlib.sha256(data).hexdigest()})
 tools.insert(2,{'tool_id':'semgrep','version':'fixture','sha256':'f'*64})
 (root/'tools.lock.json').write_text(json.dumps({'image':'fixture','tools':tools}))
 stream=io.BytesIO()
 with zipfile.ZipFile(stream,'w') as archive:archive.writestr('fixture.json',json.dumps({'id':'fixture','modified':'2026-11-08T00:00:00Z','affected':[]}))
 database=stream.getvalue();calls=[]
 def download(url,path,limit,metadata=None):
  calls.append((url,limit));data=payloads.get(url,database);path.write_bytes(data);return len(data)
 m.download=download
`;
test('preparation timing measures each real acquisition boundary without changing outputs or download counts',async()=>timingCheck(syntheticAcquisition+`
 results=[];call_sets=[]
 for enabled in [False,True]:
  calls.clear();t=m.PreparationTiming(enabled,lambda:1000000)
  target=root/str(enabled);result=m.acquire(target,['npm','PyPI','Pub'],timing=t)
  for row in result['databases']:row.pop('fetched_at');row.pop('checked_at')
  results.append(result);call_sets.append(list(calls))
  assert sorted(p.name for p in (target/'bin').iterdir())==['gitleaks','osv','trivy']
  assert len(result['tools'])==4 and len(result['databases'])==3
  if enabled:
   rows=report(t)['stages']
   expected=[name+'_'+phase for name in ['gitleaks','osv','trivy'] for phase in ['download','checksum','extract']]+[name+'_database_'+phase for name in ['npm','PyPI','Pub'] for phase in ['download','validation']]
   assert [row['stage_id'] for row in rows]==expected
   assert all(row['status']=='completed' and row['duration_ms']==0 for row in rows)
 assert results[0]==results[1] and call_sets[0]==call_sets[1] and len(call_sets[0])==6
`));

test('preparation timing records checksum, database and download failures without exposing exception data',async()=>timingCheck(syntheticAcquisition+`
 original_download=m.download
 for mode,stage,code in [('checksum','gitleaks_checksum','checksum_invalid'),('database','npm_database_validation','database_empty'),('download','gitleaks_download','credential-download-secret')]:
  t=m.PreparationTiming(True,lambda:0)
  def failing_download(url,path,limit,metadata=None):
   if mode=='download':raise ValueError(code)
   if mode=='checksum':path.write_bytes(b'wrong');return 5
   if url.endswith('/npm/all.zip'):
    with zipfile.ZipFile(path,'w'):pass
    return path.stat().st_size
   return original_download(url,path,limit,metadata)
  m.download=failing_download
  try:m.acquire(root/mode,['npm'],timing=t);raise AssertionError('expected failure')
  except ValueError as error:assert str(error)==code
  r=report(t);assert r['stages'][-1]=={'stage_id':stage,'status':'failed','duration_ms':0}
  assert 'credential' not in json.dumps(r) and 'fixture.invalid' not in json.dumps(r)
`));
