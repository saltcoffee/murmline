import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractReleaseNotes } from './release-notes.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, pkg, lock, versions] = await Promise.all(
  ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'].map(json),
);
assert.equal(manifest.id, 'murmur');
assert.equal(manifest.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(versions[pkg.version], manifest.minAppVersion);
assert.equal(manifest.minAppVersion, '1.8.7');
assert.equal(manifest.isDesktopOnly, false);
extractReleaseNotes(await readFile('CHANGELOG.md', 'utf8'), manifest.version);
for (const file of ['main.js', 'styles.css', 'README.md', 'README.zh-CN.md']) {
  assert.ok((await readFile(file)).length, file);
}
