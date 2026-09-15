import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
export function validateRelease(pkg, tag, repository) {
  if (pkg.private || pkg.name !== 'nekomimi') throw new Error('Package is not publishable');
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || tag !== `v${pkg.version}`) throw new Error('Release tag must match package version');
  if (!repository || pkg.repository?.url !== `git+https://github.com/${repository}.git`) throw new Error('Repository metadata mismatch');
  if (!pkg.license || pkg.license === 'UNLICENSED') throw new Error('Confirm a license before publishing');
}
export function assertUnpublished(status) {
  if (status !== 404) throw new Error(status >= 200 && status < 300 ? 'Version already exists: inspect registry integrity; never overwrite or blindly retry' : `Registry check failed: ${status}`);
}
if (process.argv[1]?.endsWith('/release-check.mjs')) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  validateRelease(pkg, process.env.RELEASE_TAG, process.env.GITHUB_REPOSITORY);
  await readFile('LICENSE');
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
  assertUnpublished(response.status);
  console.log(`Ready to build ${pkg.name}@${pkg.version}`);
}
