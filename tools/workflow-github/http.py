"""Fixed HTTPS transport over private stdio. Never emits exception text or credentials in diagnostics."""
import json,sys,urllib.request,urllib.error,re

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def request(value):
    if not isinstance(value,dict) or set(value)-{'method','path','headers','body','token'}:raise ValueError()
    method=value['method'];path=value['path'];token=value.get('token')
    if method not in ['GET','POST','PATCH','DELETE'] or not isinstance(path,str) or not path.startswith('/') or path.startswith('//') or any(c in path for c in ['\r','\n','\\','#']):raise ValueError()
    headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'workflow-github/1.0'}
    for key,val in value.get('headers',{}).items():
        if key.lower() not in ['accept','x-github-api-version','if-none-match'] or not isinstance(val,str) or '\r' in val or '\n' in val:raise ValueError()
        headers[key]=val
    if token is not None:
        if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,16384}',token):raise ValueError()
        headers['Authorization']='Bearer '+token
    data=json.dumps(value['body']).encode() if 'body' in value else None
    if data is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request('https://api.github.com'+path,data=data,headers=headers,method=method)
    # Keep the inherited proxy/CA configuration and TLS verification; never follow redirects.
    try:response=urllib.request.build_opener(NoRedirect()).open(req,timeout=10)
    except urllib.error.HTTPError as error:response=error
    with response:
        raw=response.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError()
        body=json.loads(raw) if raw else None
        allowed={'link','etag','retry-after','deprecation','sunset','x-ratelimit-remaining','x-github-request-id'}
        return {'status':response.code,'headers':{key.lower():val for key,val in response.headers.items() if key.lower() in allowed},'body':body}

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(8*1024*1024+1)
        if len(raw)>8*1024*1024:raise ValueError()
        sys.stdout.write(json.dumps(request(json.loads(raw))))
    except Exception:
        sys.stdout.write('{"error":"http_transport_failed"}');sys.exit(1)
