// Reproduces the inline diagnostic command recorded in rename-probe.log.
// Run inside Linux with /shared bound to a host directory and /var/tmp native.
import {mkdtemp, writeFile, rename, readFile, rm} from 'node:fs/promises';
for (const base of ['/shared/rename-probe-', '/var/tmp/rename-probe-']) {
  const directory = await mkdtemp(base), file = directory + '/watermark';
  await writeFile(file, 'initial');
  let running = true, reads = 0;
  const errors = {};
  await Promise.all([
    (async () => {
      try {
        for (let i = 0; i < 5000; i++) {
          await writeFile(directory + '/next', String(i));
          await rename(directory + '/next', file);
        }
      } finally { running = false; }
    })(),
    (async () => {
      while (running) {
        try { await readFile(file); reads++; }
        catch (error) { errors[error.code] = (errors[error.code] ?? 0) + 1; }
      }
    })(),
  ]);
  console.log(JSON.stringify({base, renames: 5000, reads, errors}));
  await rm(directory, {recursive: true});
}
