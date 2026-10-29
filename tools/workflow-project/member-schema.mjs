import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const root=new URL('../../',import.meta.url),ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
for(const [dir,kinds] of [['issue',['common']],['project',['common','project','team']],['project-member-checks',['context','result']]])for(const kind of kinds){
  ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/'+dir+'/v1/'+kind+'.schema.json',root),'utf8')));
}
const urns={project:'urn:ai-workflow:project:v1:project',team:'urn:ai-workflow:project:v1:team',context:'urn:ai-workflow:project-member-checks:v1:context',result:'urn:ai-workflow:project-member-checks:v1:result'};
export function validateMemberArtifact(kind,value) {
  const v=ajv.getSchema(urns[kind]);if(!v)throw Error('unknown_member_artifact');return {valid:!!v(value)};
}
