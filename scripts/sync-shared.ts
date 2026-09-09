import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The mini program can only compile files inside miniprogramRoot, so the shared
// rule engine is copied verbatim instead of being imported across the boundary.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['cards.ts', 'types.ts'];
const target = resolve(root, 'miniprogram', 'shared');
mkdirSync(target, { recursive: true });
for (const file of files) {
  const source = readFileSync(resolve(root, 'shared', file), 'utf8');
  writeFileSync(resolve(target, file), `// 由 scripts/sync-shared.ts 从 shared/ 生成，请勿直接修改。\n${source}`, 'utf8');
}
console.log(`已同步 ${files.join('、')} 到 miniprogram/shared`);
