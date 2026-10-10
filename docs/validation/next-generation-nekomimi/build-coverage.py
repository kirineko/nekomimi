"""生成实际任务与证据导航；不将链接存在等同于场景通过。"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[3]
CHANGE = ROOT / 'openspec/changes/next-generation-nekomimi'
OUT = Path(__file__).resolve().parent
# 每个数组位置对应同能力文档中该 Requirement 的顺序；增加/删除要求会使校验失败。
BINDINGS = {
 'codemode-execution': ['5.1','5.2,5.6','5.3,5.8','5.3,5.8','5.4'],
 'context-compaction': ['4.6','4.5,4.6','4.6'],
 'context-occupancy': ['4.5,10.5','10.5'],
 'context-selection-policy': ['4.2','4.3','4.4','4.5','4.7'],
 'core-change-candidates': ['8.1','8.2,8.3','8.4,8.5','8.6','8.4,10.8'],
 'customization-development': ['7.1,7.7','7.3,7.4,7.5','7.3'],
 'customization-lifecycle': ['7.6','7.4,7.6,10.2'],
 'customization-release-readiness': ['11.1,11.2,11.5','11.4,11.8'],
 'execution-journal': ['2.4,2.5','2.1','2.5,3.7','1.4,2.2,2.4,2.5'],
 'extension-runtime': ['7.1','2.6,7.2'],
 'extension-process-host': ['7.1,11.1'],
 'local-user-configuration': ['2.1,10.4,11.1,11.5'],
 'mcp-context-and-auth': ['6.4','6.5'],
 'mcp-tool-integration': ['6.1,6.2','6.3','6.1,6.6'],
 'mode-session-handoff': ['3.4','3.5','3.6','3.7,4.7'],
 'model-call-evidence': ['2.7','2.7,5.6'],
 'model-operation-catalog': ['5.5','5.6','5.5,5.6','5.7'],
 'pi-platform-integration': ['2.2,2.8','2.3,2.8,11.4','2.1,11.5','1.4,2.2,2.3'],
 'prompt-context-provenance': ['4.1,4.3','4.2,4.4','4.6,4.7'],
 'prompt-task-profiles': ['4.1','4.1,4.7'],
 'runtime-ui-extensions': ['9.1,9.6','9.6','9.6'],
 'self-customization-workflow': ['7.8','7.8,11.4','7.7','7.1,7.7'],
 'session-lifecycle': ['3.7','3.1,3.7','1.4,2.3,3.7'],
 'web-customization': ['10.2,10.4','9.1,9.5','10.4','9.5,10.9'],
 'web-design-system': ['9.1','9.5,10.9','9.2,9.5','9.3,10.7','9.4,9.6,10.9'],
 'web-evidence-inspector': ['10.5','10.6','10.6'],
 'web-session-stream': ['9.3,9.4','9.4,10.7'],
 'web-task-workbench': ['10.1','10.1','9.2,10.1,10.2','10.2,10.8'],
 'workspace-references': ['10.9'],
 'work-create-modes': ['3.1','3.2','3.3','3.2,3.3'],
}

def main():
 tasks_text = (CHANGE / 'tasks.md').read_text()
 tasks = {m.group(2): {'done': m.group(1) == 'x', 'description': m.group(3)} for m in re.finditer(r'^- \[([ x])\] (\d+(?:\.\d+)+) (.+)$', tasks_text, re.M)}
 catalog = json.loads((OUT/'evidence-catalog.json').read_text())
 requirements, scenarios = [], []
 paths = sorted((CHANGE / 'specs').glob('*/spec.md'))
 assert {p.parent.name for p in paths} == set(BINDINGS) == set(catalog)
 for capability, evidence in catalog.items():
  assert evidence['reports'] and evidence['tests'], capability
  for name in evidence['reports'] + evidence['tests']:
   assert (ROOT/name).is_file(), name
 for path in paths:
  text = path.read_text(); capability = path.parent.name
  starts = list(re.finditer(r'^### Requirement: (.+)$', text, re.M))
  assert len(starts) == len(BINDINGS[capability]), capability
  for i, start in enumerate(starts):
   block = text[start.end():starts[i+1].start() if i+1 < len(starts) else len(text)]
   req_id = f'{capability}/R{i+1:02}'
   task_ids = BINDINGS[capability][i].split(','); assert set(task_ids) <= tasks.keys()
   pending = [task for task in task_ids if not tasks[task]['done']]
   # Evidence navigation is not an automatic assertion that every linked test
   # proves every scenario; final gates remain explicit and separately audited.
   evidence = catalog[capability]
   req = {'id': req_id, 'capability': capability, 'title': start.group(1), 'source': str(path.relative_to(ROOT)), 'line': text[:start.start()].count('\n')+1, 'tasks': task_ids, 'pendingTasks': pending, 'reports': evidence['reports'], 'tests': evidence['tests'], 'status': 'pending-gate' if pending else 'task-evidence-recorded'}
   requirements.append(req)
   matches = list(re.finditer(r'^#### Scenario: (.+)$', block, re.M)); assert matches, req_id
   for j, scenario in enumerate(matches):
    body = block[scenario.end():matches[j+1].start() if j+1 < len(matches) else len(block)].strip()
    assert '**WHEN**' in body and '**THEN**' in body, req_id
    scenarios.append({'id': f'{req_id}/S{j+1:02}', 'requirement': req_id, 'title': scenario.group(1), 'tasks': task_ids, 'pendingTasks': pending, 'source': str(path.relative_to(ROOT)), 'line': text[:start.end()+scenario.start()].count('\n')+1, 'contract': body, 'reports': evidence['reports'], 'tests': evidence['tests'], 'status': req['status']})
 assert len({r['id'] for r in scenarios}) == len(scenarios)
 result = {'scope': '逐场景任务与实际证据导航；任务勾选不替代最终门槛或断言审计', 'capabilities': len(paths), 'requirementCount': len(requirements), 'scenarioCount': len(scenarios), 'taskProgress': {'complete':sum(t['done'] for t in tasks.values()),'total':len(tasks)}, 'specSha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, 'requirements': requirements, 'scenarios': scenarios}
 (OUT/'coverage.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
 lines = ['# 全部 delta 任务与验收证据映射', '', f'覆盖 {len(paths)} 能力、{len(requirements)} Requirement、{len(scenarios)} Scenario。', '', '索引使用实际存在的报告和测试文件，不再指向拟建的 next-generation 测试目录。每个场景保留 WHEN/THEN、规格摘要及关联任务。**任务证据已记录不等于最新全量门槛已通过**；关联测试需结合报告与实际断言审阅，测试文件存在本身不是通过证据。未完成的关联任务明确保留。', '', '再生成：`python3 docs/validation/next-generation-nekomimi/build-coverage.py`。缺失报告/测试、遗漏能力/任务或 Requirement 数量变化会失败。', '']
 for req in requirements:
  lines += [f'## {req["id"]} — {req["title"]}', '', f'来源：`{req["source"]}:{req["line"]}`；任务：{", ".join(req["tasks"])}。', '', '验收报告：'+'、'.join(f'[{Path(name).parent.name}/{Path(name).name}]({Path(name).relative_to(OUT.relative_to(ROOT))})' for name in req['reports']), '', '关联测试：'+'、'.join(f'`{name}`' for name in req['tests']), '', '| 场景ID | 场景 | 证据 | 状态 |', '| --- | --- | --- | --- |']
  for scenario in scenarios:
   if scenario['requirement'] != req['id']:continue
   first=Path(scenario['reports'][0]).relative_to(OUT.relative_to(ROOT))
   state='待完成任务 '+', '.join(scenario['pendingTasks']) if scenario['pendingTasks'] else '任务证据已记录'
   lines.append(f'| {scenario["id"].split("/")[-1]} | {scenario["title"]} | [报告]({first})，测试见上 | {state} |')
  lines += ['']
 (OUT/'coverage.md').write_text('\n'.join(lines)+'\n')
 print(json.dumps({k:result[k] for k in ['capabilities','requirementCount','scenarioCount','taskProgress']},ensure_ascii=False))

if __name__ == '__main__': main()
