import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync('scripts/01-core.js','utf8');
const begin=source.indexOf('const neisOAuthCallbackTokens=(()=>');
const end=source.indexOf("const NEIS_AUTH_STAY_KEY=",begin);
assert(begin>=0 && end>begin,'OAuth helper must exist');
const fragment=source.slice(begin,end);
const run=async(success)=>{
  let url='';
  let requests=0;
  const location={
    hash:'#access_token=fake-token&refresh_token=fake-refresh&provider_token=fake-provider&expires_in=3600',
    search:'',pathname:'/',href:'https://neiscircle.site/#access_token=fake-token&refresh_token=fake-refresh&provider_token=fake-provider'
  };
  const window={};
  const history={state:null,replaceState(_state,_unused,target){url=target}};
  const context=vm.createContext({
    window,location,history,URL,URLSearchParams,Promise,setTimeout,clearTimeout,
    console:{warn(){}}
  });
  const recovery=vm.runInContext(fragment+'\n neisRecoverImplicitOAuth',context);
  const session=await recovery({
    auth:{async setSession(tokens){
      requests++;
      assert.equal(tokens.access_token,'fake-token');
      assert.equal(tokens.refresh_token,'fake-refresh');
      return success?{data:{session:{user:{id:'synthetic-user'}}},error:null}:{data:{session:null},error:{name:'AuthApiError'}};
    }}
  });
  assert.equal(requests,1);
  assert.equal(url,'/','OAuth fragment must be removed from address');
  assert.equal(window.__NEISOAuthCallbackPending,false);
  if(success)assert.equal(session.user.id,'synthetic-user');
  else{
    assert.equal(session,null);
    assert.equal(window.__NEISOAuthRecoveryFailed,true);
  }
};
await run(true);
await run(false);
console.log('OAuth callback recovery tests passed (synthetic credentials only)');
