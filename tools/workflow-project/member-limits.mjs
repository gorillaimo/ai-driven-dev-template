export function memberLimits(input) {
  const {project:p,team:t,context:c}=input??{};
  const over=(v,n)=>Array.isArray(v)&&v.length>n;
  const total=(rows,key)=>Array.isArray(rows)?rows.reduce((n,r)=>n+(Array.isArray(r?.[key])?r[key].length:0),0):0;
  return over(p?.areas,200)||over(t?.members,1000)||over(c?.member_facts,1000)||over(c?.active_claims,10000)||
    over(p?.coordinators?.assignments,1000)||over(c?.request?.area_ids,200)||over(c?.request?.assignees,1000)||over(c?.request?.owner_overrides,200)||
    total(p?.areas,'paths')>10000||total(t?.members,'areas')>10000||total(t?.members,'integration_owner')>10000||total(p?.coordinators?.assignments,'area_ids')>10000;
}
