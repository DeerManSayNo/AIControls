---
name: code-metrics
description: Count lines of code in the project root excluding build artifacts and optionally import/require statements. Use when the user wants to see code volume, LOC, total code size, or metrics excluding imports or build. 汇报统计结果时一律使用中文。
---

# Code Metrics (LOC)

Count source code lines in the repository root, excluding build output and (optionally) import/require lines.

## Scope

- **Root**: Run from project root; include all source under it.
- **Exclude dirs**: Always exclude build/artifact directories so they are not counted.

## Default Exclude Directories

When counting, exclude these (and similar) paths:

- `node_modules`
- `dist`, `build`, `out`, `.next`, `.nuxt`
- `app-unpacked`, `release`, `coverage`
- `.git`, `*.min.js`, `*.bundle.js`
- Hidden dirs used for tooling: `.vite`, `.cache`, `*.d.ts` (if counting only runtime source)

Add or remove entries based on project layout (e.g. Electron: exclude `app-unpacked`).

## Method 1: cloc (recommended)

Use `cloc` to get lines by language, excluding build dirs. It already excludes comments and blanks from “code” count.

```bash
cloc . --exclude-dir=node_modules,dist,build,out,app-unpacked,release,coverage,.git,.next,.nuxt
```

If `cloc` is not installed: `npm install -g cloc` or `brew install cloc`.

Output: code lines per language and total. Import/require lines are still counted as code.

## Method 2: Excluding import/require lines

To exclude lines that are only import or require (and count the rest):

1. **List source files** (same exclude-dir list as above).
2. **Count total lines** in those files (e.g. `wc -l` or ripgrep).
3. **Count import/require lines** with a pattern, then subtract.

Example with ripgrep (from project root):

```bash
# Total lines in JS/JSX/TS/TSX, excluding dirs
rg --files . -g '!node_modules' -g '!dist' -g '!build' -g '!app-unpacked' -g '!.git' \
   -g '*.js' -g '*.jsx' -g '*.ts' -g '*.tsx' | xargs wc -l

# Count lines that are import/require (to subtract)
rg -c '^\s*(import |require\()' --type-add 'src:*.{js,jsx,ts,tsx}' -t src .
```

**Project script** (run from project root):

```bash
node .cursor/skills/code-metrics/scripts/count-loc.cjs
```

By default this excludes import/require lines. Use `--with-imports` to include them.

## Method 3: tokei

Alternative to cloc; same idea:

```bash
tokei . -e node_modules,dist,build,app-unpacked,release,coverage,.git
```

## Output Format

**汇报语言**：向用户汇报统计结果时**一律使用中文**（包括标题、说明、列表和数字旁的说明文字）。

When reporting back to the user:

1. **总行数**：代码总行数（若用 cloc 可附带空行/注释行）。
2. **按语言**：各语言行数（如 JavaScript、JSX、CSS、JSON 等，如有）。
3. **已排除项**：说明本次排除了哪些目录/文件，例如「已排除：node_modules、dist、build、app-unpacked」。
4. 若排除了 import/require 行：说明「已排除 import/require 行」。

总结保持简短（一个小表格或列表即可）。

## Checklist

汇报前确认：

- [ ] 在项目根目录下执行。
- [ ] 已排除 `node_modules`、`dist`、`build` 等构建/产物目录。
- [ ] 若用户要求排除「引入」：已排除 import/require 行。
- [ ] 若用户要求排除「构建」：已排除构建输出目录及仅用于构建的配置。
