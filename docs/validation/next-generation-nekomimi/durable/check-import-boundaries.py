"""从仓库根运行，核对实际安装包公开 exports 和产品协议隔离。"""
import json
import pathlib
import re
import fnmatch

result = []
for path in pathlib.Path('src').rglob('*.ts*'):
    source = path.read_text()
    assert not re.search(r'(?:from|import\()[^\n]*[\'\"][^\'\"]*/reference/', source), path
    for target in re.findall(r'[\'\"](@earendil-works/[^\'\"]+)[\'\"]', source):
        parts = target.split('/')
        package = '/'.join(parts[:2])
        subpath = '.' if len(parts) == 2 else './' + '/'.join(parts[2:])
        base = pathlib.Path('node_modules') / package
        manifest = json.loads((base / 'package.json').read_text())
        keys = [key for key in manifest['exports'] if fnmatch.fnmatchcase(subpath, key)]
        assert keys, (path, target)
        export = keys[0]
        match = subpath[len(export.split('*')[0]):] if '*' in export else ''
        for kind in ['types', 'import']:
            destination = manifest['exports'][export][kind].replace('*', match)
            assert (base / destination).is_file(), (target, destination)
        result.append({'source': str(path), 'import': target, 'version': manifest['version'], 'publicExport': export})
assert not any(item['import'].startswith('@earendil-works/pi-agent-core') for item in result)
for path in [*pathlib.Path('src/web').rglob('*.ts*'), *pathlib.Path('src/shared').rglob('*.ts'), pathlib.Path('src/customization/sdk-contracts.ts'), pathlib.Path('src/customization/types.ts')]:
    assert '@earendil-works/' not in path.read_text(), path
output = {'imports': result, 'browserAndProductProtocolFrameworkImports': 0, 'oldAgentImports': 0}
pathlib.Path(__file__).with_name('import-boundaries.json').write_text(json.dumps(output, indent=2) + '\n')
print('Public exports checked:', len(result))
