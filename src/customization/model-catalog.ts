import type {ProviderRegistry} from './provider-registry.js';
import type {Profiles} from './provider-profiles.js';
import type {Resource} from './resources.js';

/** Read-only catalog projection. Never loads factories or returns credential values. */
export function modelCatalog(registry:ProviderRegistry,profiles:Profiles,credentials:Readonly<Record<string,string>>,builtinConfigured:boolean,resources:readonly Resource[]){
 return registry.catalog().map(provider=>({...provider,models:provider.models.map(model=>{
  const operation=model.operation??'chat',resourceId='resourceId' in provider?provider.resourceId:'builtin:deepseek';
  const matches=Object.values(profiles.entries).filter(profile=>profile.providerId===provider.id&&profile.resourceId===resourceId&&profile.model===model.id&&(profile.operation??'chat')===operation);
  const requiresCredential=model.credentialRequired||operation!=='chat'&&['typesafe-system-one','openrouter-images'].includes(model.protocol);
  const bound=provider.id==='deepseek'||matches.length>0;
  const authenticated=provider.id==='deepseek'&&builtinConfigured||matches.some(profile=>profile.credentialRef?!!credentials[profile.credentialRef]:!requiresCredential);
  const current=provider.id==='deepseek'||resources.some(resource=>resource.id===resourceId&&resource.status==='enabled'&&resource.hash===provider.revision);
  const reason=!current?'resource-unavailable':!bound?'profile-not-configured':!authenticated?'credential-not-configured':operation!=='chat'&&model.protocol!==(operation==='classifier'?'typesafe-system-one':'openrouter-images')?'unsupported-operation-protocol':undefined;
  const profileStates=matches.map(profile=>{
   const authenticated=profile.credentialRef?!!credentials[profile.credentialRef]:!requiresCredential;
   const unavailableReason=!current?'resource-unavailable':!authenticated?'credential-not-configured':operation!=='chat'&&model.protocol!==(operation==='classifier'?'typesafe-system-one':'openrouter-images')?'unsupported-operation-protocol':undefined;
   return {id:profile.id,credentialStatus:profile.credentialRef||requiresCredential?(authenticated?'configured':'missing'):'not-required',available:unavailableReason===undefined,...(unavailableReason?{unavailableReason}:{})};
  });
  return {...model,routing:'physical' as const,operation,identity:JSON.stringify([provider.id,operation,model.id]),profileStates,profileIds:matches.map(profile=>profile.id),credentialStatus:!requiresCredential&&!matches.some(p=>p.credentialRef)?'not-required':authenticated?'configured':'missing',configured:bound&&authenticated,available:reason===undefined,...(reason?{unavailableReason:reason}:{})};
 })}));
}
