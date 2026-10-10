import subprocess,os,sys,json,time
from pathlib import Path
kind=sys.argv[1]
root='/Users/kirineko/Github/nekomimi'
tar='/tmp/nekomimi-final-clean-tar/nekomimi-0.2.1.tgz'
results=[]
for version in ['24.15.0','22.19.0']:
 log=f'/tmp/nekomimi-clean-{kind}-{version}.log'
 if kind=='macos':
  binary='node' if version=='24.15.0' else '/tmp/nekomimi-node-22.19.0/node-v22.19.0-darwin-arm64/bin/node'
  args=[binary,'scripts/pack-smoke.mjs',tar]
  env=os.environ.copy()
  if version=='22.19.0':env['PATH']=str(Path(binary).parent)+os.pathsep+env['PATH']
 else:
  args=['docker','run','--rm','--mount','type=bind,src='+root+',dst=/harness,readonly','--mount','type=bind,src=/tmp/nekomimi-final-clean-tar,dst=/artifact,readonly','--mount','type=bind,src=/tmp/nekomimi-linux-npm-cache,dst=/root/.npm','--workdir','/harness','node:'+version+'-bookworm','node','scripts/pack-smoke.mjs','/artifact/nekomimi-0.2.1.tgz']
  env=os.environ.copy()
 with open(log,'w') as f:r=subprocess.run(args,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
 result={'platform':kind,'node':version,'exitCode':r.returncode,'log':log}
 results.append(result);print(json.dumps(result),flush=True)
 if r.returncode:break
Path('/tmp/nekomimi-clean-'+kind+'-results.json').write_text(json.dumps(results,indent=2)+'\n')
sys.exit(0 if len(results)==2 and all(x['exitCode']==0 for x in results) else 1)
