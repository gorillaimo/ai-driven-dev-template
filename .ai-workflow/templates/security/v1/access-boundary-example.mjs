// Teaching example only. Adapt requirements and test the real application's entry points.
export function readConversation(session,conversation){
 if(!session?.user_id||!session.tenant_id)return {status:401};
 if(session.tenant_id!==conversation.tenant_id)return {status:403};
 if(session.user_id!==conversation.owner_id&&session.role!=='tenant_admin')return {status:403};
 return {status:200,data:conversation.message};
}
export function guardedToolRequest(request){
 // LLM text cannot grant a tool permission or bypass the structured scope.
 if(request.tool!=='read_public_help'||request.contains_secret||request.external_destination)return {allowed:false};
 return {allowed:true};
}
