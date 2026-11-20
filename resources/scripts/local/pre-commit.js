import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, mkdirSync, symlinkSync, rmSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const root = git('rev-parse', '--show-toplevel');
process.chdir(root);
const tree = git('write-tree');
const files = execFileSync('git', [
  'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'
], {encoding: 'utf8'}).split('\0').filter(Boolean);
const snapshot = mkdtempSync(join(tmpdir(), 'dwv-pre-commit-'));

try {
  execFileSync('git', ['checkout-index', '--all', '--prefix', `${snapshot}/`]);
  const stagedPackage = JSON.parse(readFileSync(
    join(snapshot, 'package.json'), 'utf8'));
  const localPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  const dependencyFields = ['name',
    'version',
    'packageManager',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'resolutions',
    'workspaces'];
  const dependencyMismatch = dependencyFields.some((field) =>
    JSON.stringify(stagedPackage[field]) !==
    JSON.stringify(localPackage[field]));
  const configMismatch = ['yarn.lock', '.yarnrc.yml'].some((file) =>
    !readFileSync(join(snapshot, file)).equals(readFileSync(file)));
  if (dependencyMismatch || configMismatch) {
    throw new Error('Stage dependency and Yarn configuration changes first.');
  }
  const install = spawnSync('corepack', ['yarn', 'install', '--immutable'], {
    stdio: 'inherit'
  });
  if (install.error) {
    throw install.error;
  }
  if (install.status !== 0) {
    process.exitCode = install.status ?? 1;
  } else {
    symlinkSync(join(root, 'node_modules'), join(snapshot, 'node_modules'),
      'junction');
    mkdirSync(join(snapshot, '.yarn'), {recursive: true});
    symlinkSync(join(root, '.yarn/install-state.gz'),
      join(snapshot, '.yarn/install-state.gz'));
    const env = {...process.env};
    for (const name of git('rev-parse', '--local-env-vars').split('\n')) {
      delete env[name];
    }
    const result = spawnSync('corepack', ['yarn', 'verify', '--', ...files], {
      cwd: snapshot, env, stdio: 'inherit'
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
    if (git('write-tree') !== tree) {
      throw new Error('The Git index changed during checks. Commit again.');
    }
  }
} finally {
  rmSync(snapshot, {recursive: true, force: true});
}
