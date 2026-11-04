#!/usr/bin/env python3
"""Acquire public, pinned tools and bounded OSV snapshots. No project data is sent."""
import datetime,email.utils,hashlib,json,os,signal,stat,sys,tarfile,tempfile,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MAX_TOOL=256*1024*1024
MAX_DB=1024*1024*1024
MAX_EXPANDED=2*1024*1024*1024
MAX_ENTRIES=100000
STAGE="arguments"
TOOL=None

class DatabaseLimitError(ValueError):
    def __init__(self,code,counts):
        super().__init__(code)
        self.counts=counts

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def download(url,path,limit,metadata=None):
    # URLs come only from the bundled catalog or the fixed OSV endpoint below.
    request=urllib.request.Request(url,headers={'User-Agent':'workflow-security/1.0'})
    with urllib.request.urlopen(request,timeout=60) as r,path.open('xb') as out:
        if metadata is not None:
            modified=r.headers.get('Last-Modified')
            if modified:
                try:metadata['source_modified_at']=email.utils.parsedate_to_datetime(modified).astimezone(datetime.timezone.utc).isoformat().replace('+00:00','Z')
                except Exception:pass
        if int(r.headers.get('Content-Length','0'))>limit:raise ValueError('download_limit')
        total=0
        while True:
            data=r.read(1024*1024)
            if not data:break
            total+=len(data)
            if total>limit:raise ValueError('download_limit')
            out.write(data)
    return total

def inspect_database(path):
    entries=0;expanded=0;advisories=0
    with zipfile.ZipFile(path) as z:
        rows=z.infolist()
        counts={'database_entries':len(rows),'database_expanded_bytes':sum(row.file_size for row in rows),'database_compressed_bytes':path.stat().st_size}
        if counts['database_entries']>MAX_ENTRIES:raise DatabaseLimitError('database_entry_limit',counts)
        if counts['database_expanded_bytes']>MAX_EXPANDED:raise DatabaseLimitError('database_expanded_limit',counts)
        for row in rows:
            entries+=1;expanded+=row.file_size
            parts=Path(row.filename).parts
            if entries>MAX_ENTRIES:raise ValueError('database_entry_limit')
            if expanded>MAX_EXPANDED:raise ValueError('database_expanded_limit')
            if row.filename.startswith('/') or '..' in parts or '\\' in row.filename or stat.S_ISLNK(row.external_attr>>16):raise ValueError('database_invalid')
            if row.is_dir():continue
            if not row.filename.endswith('.json') or row.file_size>2*1024*1024:raise ValueError('database_format_invalid')
            try:
                data=json.loads(z.read(row))
                if not isinstance(data,dict) or not isinstance(data.get('id'),str) or not data['id'] or not isinstance(data.get('modified'),str):raise ValueError()
                datetime.datetime.fromisoformat(data['modified'].replace('Z','+00:00'))
                version=data.get('schema_version','1.0.0').split('.')
                if version[0]!='1' or int(version[1])>9:raise ValueError()
                if not isinstance(data.get('affected',[]),list):raise ValueError()
            except Exception as error:raise ValueError('database_format_invalid') from error
            advisories+=1
    if advisories==0:raise ValueError('database_empty')
    return {'entries':entries,'expanded':expanded,'advisories':advisories}

def acquire(destination,ecosystems):
    global STAGE,TOOL
    if any(e not in ['npm','PyPI','Pub'] for e in ecosystems) or len(ecosystems)>3 or len(set(ecosystems))!=len(ecosystems):raise ValueError('ecosystem_invalid')
    target=Path(destination)
    if target.exists():raise ValueError('output_exists')
    target.mkdir(mode=0o700,parents=False)
    (target/'bin').mkdir(mode=0o755);(target/'db').mkdir(mode=0o755)
    catalog=json.loads((ROOT/'tools.lock.json').read_text())
    inventory={'image':catalog['image'],'tools':[],'databases':[]}
    for tool in catalog['tools']:
        if tool['tool_id']=='semgrep':
            inventory['tools'].append({'tool_id':'semgrep','version':tool['version'],'binary_digest':tool['sha256'],'archive_digest':tool['sha256']});continue
        STAGE='tool_download';TOOL=tool['tool_id']
        archive=target/(tool['tool_id']+'.download')
        download(tool['url'],archive,MAX_TOOL)
        if sha(archive)!=tool['sha256']:raise ValueError('checksum_invalid')
        binary=target/'bin'/tool['binary']
        if tool['tool_id']=='osv':os.replace(archive,binary)
        else:
            with tarfile.open(archive,'r:gz') as tar:
                members=[m for m in tar.getmembers() if m.name==tool['binary']]
                if len(members)!=1 or not members[0].isfile() or members[0].size>MAX_TOOL:raise ValueError('archive_invalid')
                with tar.extractfile(members[0]) as src,binary.open('xb') as dst:
                    total=0
                    while True:
                        block=src.read(1024*1024)
                        if not block:break
                        total+=len(block)
                        if total>MAX_TOOL:raise ValueError('archive_limit')
                        dst.write(block)
            archive.unlink()
        binary.chmod(0o555)
        inventory['tools'].append({'tool_id':tool['tool_id'],'version':tool['version'],'binary_digest':sha(binary),'archive_digest':tool['sha256']})
    compressed=0;expanded=0;entries=0
    for ecosystem in ecosystems:
        STAGE='database_download';TOOL=None
        directory=target/'db'/ecosystem;directory.mkdir(mode=0o755)
        path=directory/'all.zip';source='https://osv-vulnerabilities.storage.googleapis.com/'+ecosystem+'/all.zip'
        metadata={}
        compressed+=download(source,path,MAX_DB-compressed,metadata)
        STAGE='database_validation'
        inspected=inspect_database(path);entries+=inspected['entries'];expanded+=inspected['expanded']
        if entries>MAX_ENTRIES:raise ValueError('database_entry_limit')
        if expanded>MAX_EXPANDED:raise ValueError('database_expanded_limit')
        now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
        inventory['databases'].append({'ecosystem':ecosystem,'digest':sha(path),'fetched_at':now,'checked_at':now,'source':source,'snapshot_kind':'public_snapshot','advisory_count':inspected['advisories'],**metadata})
        path.chmod(0o444)
    (target/'inventory.json').write_text(json.dumps(inventory,indent=2)+'\n');(target/'inventory.json').chmod(0o600)
    target.chmod(0o755)
    return inventory

if __name__=='__main__':
    try:
        if len(sys.argv)!=3:raise ValueError('arguments_invalid')
        signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError()))
        signal.alarm(600)
        result=acquire(sys.argv[1],sys.argv[2].split(',') if sys.argv[2] else [])
        print(json.dumps({'status':'acquired','tools':len(result['tools']),'databases':len(result['databases'])}))
    except Exception as error:
        known={'ecosystem_invalid','output_exists','download_limit','checksum_invalid','archive_invalid','archive_limit','database_invalid','database_format_invalid','database_empty','database_entry_limit','database_expanded_limit','arguments_invalid'}
        code=str(error) if isinstance(error,ValueError) and str(error) in known else 'acquisition_failed'
        counts=error.counts if isinstance(error,DatabaseLimitError) else {}
        print(json.dumps({'status':'error','code':code,'stage':STAGE,'tool_id':TOOL,'http_status':getattr(error,'code',None) if isinstance(getattr(error,'code',None),int) else None,**counts}));sys.exit(1)
