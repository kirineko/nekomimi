import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease, assertUnpublished } from './release-check.mjs';
const pkg={name:'nekomimi',version:'0.1.0',license:'MIT',repository:{url:'git+https://github.com/kirineko/nekomimi.git'}};
test('valid release metadata',()=>assert.doesNotThrow(()=>validateRelease(pkg,'v0.1.0','kirineko/nekomimi')));
for(const [name,change,tag,repo] of [
  ['private',{private:true},'v0.1.0','kirineko/nekomimi'],
  ['wrong version',{},'v0.2.0','kirineko/nekomimi'],
  ['prerelease',{version:'0.1.0-beta.1'},'v0.1.0-beta.1','kirineko/nekomimi'],
  ['wrong repository',{},'v0.1.0','someone/nekomimi'],
  ['missing license',{license:null},'v0.1.0','kirineko/nekomimi'],
]) test(`reject ${name}`,()=>assert.throws(()=>validateRelease({...pkg,...change},tag,repo)));

test("registry availability fails closed",()=>{assert.doesNotThrow(()=>assertUnpublished(404));for(const status of [200,401,403,429,500]) assert.throws(()=>assertUnpublished(status));});
