import { input,member,fact,claim,bind } from './helpers.mjs';
export function large() {
 const i=input();for(let n=3;n<1000;n++)i.team.members.push(member('member-'+n));
 for(let n=2;n<200;n++)i.project.areas.push({area_id:'area-'+n,paths:['areas/'+n],shared:false,integration_owner:null,conflict_policy:'serialize'});
 i.context.member_facts=i.team.members.map(m=>fact(m.github_login));i.team.members[0].max_concurrent_issues=10001;
 i.context.active_claims=Array.from({length:10000},(_,n)=>claim(n+100));return bind(i);
}
