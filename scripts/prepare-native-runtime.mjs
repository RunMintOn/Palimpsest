import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Native runtime packaging currently supports macOS ARM64 only.');
}
const destination = resolve('runtime/node_modules');
for (const name of ['@zvec/zvec', '@zvec/bindings-darwin-arm64', 'detect-libc']) {
  const source = resolve('node_modules', name);
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (manifest.name !== name) throw new Error(`Unexpected runtime package: ${name}`);
  await mkdir(dirname(join(destination, name)), { recursive: true });
  await cp(source, join(destination, name), { recursive: true, dereference: true });
}
await writeFile('runtime/platform.json', JSON.stringify({ platform: process.platform, arch: process.arch, zvec: '0.7.1' }) + '\n');
console.log('Prepared independent macOS ARM64 runtime in runtime/');
