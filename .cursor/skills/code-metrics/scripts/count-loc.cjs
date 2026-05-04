#!/usr/bin/env node
/**
 * Count lines of code in project root, excluding build dirs and optionally import/require lines.
 * Run from project root: node .cursor/skills/code-metrics/scripts/count-loc.cjs [--with-imports]
 * Default: exclude import/require lines. Use --with-imports to include them.
 */

const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'app-unpacked', 'release',
  'coverage', '.git', '.next', '.nuxt', '.vite', '.cache'
]);

// 仅统计以下扩展；不含 .md .sql .json
const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.cjs', '.mjs']);

const IMPORT_RE = /^\s*(import\s|require\s*\(|export\s+.*\bfrom\s+)/;

function walk(dir, root, stats) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) walk(full, root, stats);
      continue;
    }
    const ext = path.extname(e.name);
    if (!SOURCE_EXT.has(ext)) continue;
    const content = fs.readFileSync(full, 'utf8');
    const lines = content.split(/\r?\n/);
    let imports = 0;
    for (const line of lines) {
      if (IMPORT_RE.test(line)) imports++;
    }
    if (!stats.byExt[ext]) stats.byExt[ext] = { total: 0, imports: 0 };
    stats.byExt[ext].total += lines.length;
    stats.byExt[ext].imports += imports;
    stats.total += lines.length;
    stats.importLines += imports;
  }
}

const root = process.cwd();
const excludeImports = !process.argv.includes('--with-imports');
const stats = { total: 0, importLines: 0, byExt: {} };

walk(root, root, stats);

const codeLines = excludeImports ? stats.total - stats.importLines : stats.total;

console.log('LOC (project root, build dirs excluded)');
console.log('Total lines:', stats.total);
if (excludeImports) console.log('Import/require lines:', stats.importLines);
console.log('Code lines' + (excludeImports ? ' (excl. imports)' : '') + ':', codeLines);
console.log('\nBy extension:');
for (const [ext, v] of Object.entries(stats.byExt).sort((a, b) => b[1].total - a[1].total)) {
  const code = excludeImports ? v.total - v.imports : v.total;
  console.log('  ', ext.padEnd(6), ':', String(code).padStart(6), 'lines');
}
