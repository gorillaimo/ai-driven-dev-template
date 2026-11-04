import {catalog} from './core.mjs';
export function scannerArgv(toolId,paths){
 const targets=paths.map(p=>'/src/'+p),tool=catalog.tools.find(t=>t.tool_id===toolId);if(!tool)throw Error('unsupported');
 const argv=tool.tool_id==='gitleaks'?['dir','--config=/policy/gitleaks.toml','--gitleaks-ignore-path=/policy/empty.ignore','--ignore-gitleaks-allow','--redact=100','--exit-code=10','--no-banner','--report-format=json','--report-path=/out/raw.json','/src']:tool.tool_id==='osv'?['scan','source','--offline','--no-resolve','--all-packages','--no-call-analysis=go','--config=/policy/osv-scanner.toml','--format=json','--output-file=/out/raw.json',...targets.map(p=>'--lockfile='+p)]:tool.tool_id==='semgrep'?['scan','--config=/policy/semgrep.yaml','--metrics=off','--disable-version-check','--no-trace','--no-git-ignore','--disable-nosem','--json','--error','--output=/out/raw.json',...targets]:['config','--config=/policy/trivy.yaml','--skip-check-update','--skip-version-check','--disable-telemetry','--ignorefile=/policy/empty.ignore','--exit-code=10','--format=json','--output=/out/raw.json','/src'];
 return argv;
}
export const commandTemplate=toolId=>scannerArgv(toolId,['__targets__']);
export function buildRequest({plan,check,workspace,outputDir}){
 const tool=catalog.tools.find(t=>t.tool_id===check.tool_id);if(!tool)throw Error('unsupported');
 const argv=scannerArgv(tool.tool_id,check.targets);
 return {tool_id:tool.tool_id,version:tool.version,entrypoint:tool.tool_id==='semgrep'?'semgrep':'/tools/'+tool.binary,argv,workspace,outputDir,image:catalog.image,network:'none',read_only:true,shell:false,limits:{...plan.inputs.profile.limits},plan,check};
}
