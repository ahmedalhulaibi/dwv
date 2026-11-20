import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {ESLint} from 'eslint';
import * as prettier from 'prettier';

const args = process.argv.slice(2);
const check = args[0] === '--check';
if (check) {
  args.shift();
}
const explicitFiles = args[0] === '--';
if (explicitFiles) {
  args.shift();
}
const files = explicitFiles || args.length !== 0 ? args : execFileSync('git', [
  'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'
], {encoding: 'utf8'}).split('\0').filter(Boolean);
const scripts = files.filter((file) => /\.[cm]?js$/.test(file));
const markup = files.filter((file) =>
  ['.html', '.css', '.json', '.webmanifest', '.md', '.yml', '.yaml']
    .includes(extname(file)));
let failed = false;

if (scripts.length !== 0) {
  const eslint = new ESLint({
    overrideConfigFile: 'config/eslint.config-full.js',
    fix: true,
    fixTypes: ['layout']
  });
  const results = await eslint.lintFiles(scripts);
  if (check) {
    for (const result of results) {
      if (typeof result.output !== 'undefined' || result.errorCount !== 0 ||
        result.warningCount !== 0) {
        process.stderr.write(`Format or lint required: ${result.filePath}\n`);
        failed = true;
      }
    }
    const formatter = await eslint.loadFormatter('stylish');
    process.stderr.write(formatter.format(results));
  } else {
    await ESLint.outputFixes(results);
  }
}

await Promise.all(markup.map(async (file) => {
  const info = await prettier.getFileInfo(file, {
    ignorePath: '.prettierignore'
  });
  if (info.ignored) {
    return;
  }
  const parser = extname(file) === '.webmanifest'
    ? 'json' : info.inferredParser;
  const options = {...await prettier.resolveConfig(file),
    filepath: file,
    parser};
  const content = await readFile(file, 'utf8');
  const formatted = await prettier.format(content, options);
  if (content !== formatted) {
    if (check) {
      process.stderr.write(`Format required: ${file}\n`);
      failed = true;
    } else {
      await writeFile(file, formatted);
    }
  }
}));
if (failed) {
  process.stderr.write('Run corepack yarn format, then stage the fixes.\n');
  process.exitCode = 1;
}
