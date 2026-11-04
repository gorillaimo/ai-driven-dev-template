"""Inside the offline scanner container. Never print scanner stderr or source text."""
import datetime,json,os,re,signal,socket,subprocess,sys,time
from pathlib import Path

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
config=json.loads(Path('/controller/config.json').read_text())
Path('/tmp/home').mkdir(exist_ok=True)
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':'/tmp','LANG':'C.UTF-8','OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY':'/db','OSV_SCALIBR_LOCAL_DB_CACHE_DIRECTORY':'/db','SEMGREP_SEND_METRICS':'off','SEMGREP_ENABLE_VERSION_CHECK':'0','TRIVY_CACHE_DIR':'/tmp/trivy','TRIVY_DISABLE_TELEMETRY':'true','TRIVY_SKIP_VERSION_CHECK':'true','TRIVY_SKIP_CHECK_UPDATE':'true'}
receipt={'operation_id':config['operation_id'],'started_at':now(),'finished_at':now(),'exit_code':None,'completed':False,'stopped':True,'timed_out':False,'output_limited':False,'version':'','target_count':config['target_count']}
raw=''
deadline=time.monotonic()+config['timeout_seconds']
try:
    if any(name!='lo' for _,name in socket.if_nameindex()):raise ValueError('network_boundary_invalid')
    try:
        Path('/src/.security-boundary-probe').write_text('probe')
    except OSError:pass
    else:raise ValueError('source_writable')
    version_args=['version'] if config['tool_id']=='gitleaks' else ['--version']
    version=subprocess.run([config['entrypoint'],*version_args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(15,max(0.1,deadline-time.monotonic())))
    text=(version.stdout+version.stderr).decode('utf8',errors='replace')
    if version.returncode!=0 or len(text)>65536 or not re.search(r'(?<![0-9.])v?'+re.escape(config['version'])+r'(?![0-9.])',text):raise ValueError('version_invalid')
    receipt['version']=config['version']
    p=subprocess.Popen([config['entrypoint'],*config['argv']],env=env,cwd='/src',stdin=subprocess.DEVNULL,stdout=open('/out/stdout.txt','wb'),stderr=open('/out/stderr.txt','wb'),start_new_session=True)
    try:
        receipt['exit_code']=p.wait(timeout=max(0.1,deadline-time.monotonic()));receipt['completed']=True
    except subprocess.TimeoutExpired:
        receipt['timed_out']=True
        try:os.killpg(p.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:receipt['stopped']=False
    path=Path('/out/raw.json')
    if path.is_symlink():raise ValueError('output_invalid')
    if path.exists():
        if path.stat().st_size>config['max_raw_bytes']:receipt['output_limited']=True
        else:raw=path.read_text()
except Exception:
    receipt['completed']=False
receipt['finished_at']=now()
debug={}
for name in ['stdout','stderr']:
    path=Path('/out/'+name+'.txt')
    if path.exists():
        with path.open('rb') as f:debug[name]=f.read(65536).decode('utf8',errors='replace')
sys.stdout.write(json.dumps({'receipt':receipt,'rawResult':raw,'private_debug':debug}))
