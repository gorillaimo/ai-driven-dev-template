import { fixture, finding, ref, rebind, event } from './fixture.mjs';
export function largeFixture(){
 const s=fixture(),v=s.verifications[0];
 s.verifications=Array.from({length:127},(_,i)=>({...structuredClone(v),artifact_id:'v-'+i,check_id:'unit-'+i}));
 s.profile.checks=s.verifications.map(v=>({check_id:v.check_id,kind:'verification',domain:'app',acs:['ac-1'],command_id:'unit',test_check:true,min_tests:1}));
 s.reviews[0].findings=Array.from({length:1000},(_,i)=>({...finding(),finding_id:'suggestion-'+i,category:'suggestion',severity:'info',required_ac:false}));
 rebind(s);for(const f of s.reviews[0].findings)f.subject=s.context.subject;
 s.events=Array.from({length:1000},(_,i)=>({...event(s),artifact_id:'event-'+i,operation_id:'op-'+i}));
 return s;
}
