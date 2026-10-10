import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Resource} from '../../src/customization/resources.js';
import type {McpOAuth} from '../../src/customization/mcp-oauth.js';
export async function rotatingOAuthFixture(){
 let base='',next=0,refreshes=0,calls=0;const challenges=new Map<string,string>(),refreshTokens=new Map<string,{account:number;revision:number}>(),accessTokens=new Set<string>();
 let gate:Promise<void>|undefined,release:()=>void=()=>{},entered:()=>void=()=>{};
 const server=createServer(async(req,res)=>{
  if(req.url!.startsWith('/.well-known/oauth-protected-resource')){res.setHeader('content-type','application/json');res.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base+'/']}));return;}
  if(req.url!.startsWith('/.well-known/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({issuer:base+'/',authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url==='/token'){
   const p=new URLSearchParams(raw);let account:number,revision:number;
   if(p.get('grant_type')==='authorization_code'){
    if(createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')!==challenges.get(p.get('code')!)){res.writeHead(400).end('{}');return;}
    account=++next;revision=0;
   }else{
    const token=p.get('refresh_token')!,old=refreshTokens.get(token);if(!old){res.writeHead(400).end('{}');return;}
    refreshTokens.delete(token);account=old.account;revision=old.revision+1;refreshes++;entered();await gate;
   }
   const access=`access-${account}-${revision}`,refresh=`refresh-${account}-${revision}`;accessTokens.add(access);refreshTokens.set(refresh,{account,revision});
   res.setHeader('content-type','application/json');res.end(JSON.stringify({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600}));return;
  }
  if(req.url==='/mcp'){
   if(!accessTokens.has(String(req.headers.authorization).replace('Bearer ',''))){res.writeHead(401).end();return;}
   if(req.method!=='POST'){res.writeHead(405).end();return;}
   const m=JSON.parse(raw);if(m.id===undefined){res.writeHead(202).end();return;}
   const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'rotate',version:'1'}}:m.method==='tools/list'?{tools:[{name:'job',inputSchema:{type:'object'}}]}:(calls++,{content:[{type:'text',text:'ok'}]});
   res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));return;
  }
  res.writeHead(404).end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
 const resource=(id:string)=>({id,name:id,config:{transport:'http',url:base+'/mcp',oauth:{issuer:base+'/',clientId:'public'}}} as Resource);
 return {resource,counts:()=>({refreshes,calls}),hold:()=>{gate=new Promise<void>(r=>{release=r;});return new Promise<void>(r=>{entered=r;});},release:()=>release(),authorize:async(oauth:McpOAuth,r:Resource)=>{
  const start=await oauth.begin(r),url=new URL(start.authorizationUrl),code=`code-${challenges.size}`;challenges.set(code,url.searchParams.get('code_challenge')!);
  const callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code',code);return callback;
 },close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
export async function expireOAuth(home:string,token:string){
 for(const name of await readdir(join(home,'mcp-auth'))){if(!name.endsWith('.json'))continue;const file=join(home,'mcp-auth',name),value=JSON.parse(await readFile(file,'utf8'));if(value.tokens?.access_token===token){value.expiresAt=0;await writeFile(file,JSON.stringify(value));return;}}
 throw Error('fixture credential not found');
}
