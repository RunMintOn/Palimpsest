import { cp, lstat, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const vault = process.argv[2];
if (!vault) throw new Error('Usage: node scripts/install-native-to-vault.mjs /absolute/path/to/test-vault');
const root = resolve(vault);
const plugins = join(root, '.obsidian/plugins');
const target = join(plugins, 'palimpsest');
if (!(await lstat(plugins)).isDirectory()) throw new Error('Vault plugins directory must already exist.');
for (const location of [target, join(target, 'runtime')]) {
  const stat = await lstat(location).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (stat?.isSymbolicLink()) throw new Error(`Refusing a symlink installation: ${location}`);
}
const platform = JSON.parse(await readFile('runtime/platform.json', 'utf8'));
if (platform.platform !== process.platform || platform.arch !== process.arch) throw new Error('Runtime platform does not match this machine.');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.id !== 'palimpsest') throw new Error('Unexpected plugin id.');
for (const file of ['main.js', 'manifest.json', 'styles.css', 'runtime']) await lstat(file);
await mkdir(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'runtime']) {
  await cp(file, join(target, file), { recursive: true, dereference: true });
}
console.log(`Installed macOS runtime in ${target}; settings and indexes preserved.`);
