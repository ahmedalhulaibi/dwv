import {execFileSync} from 'node:child_process';
import {existsSync, chmodSync} from 'node:fs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8'
}).trim();
process.chdir(root);
const hooks = execFileSync('git', ['config',
  '--get',
  '--default',
  '',
  'core.hooksPath'], {encoding: 'utf8'}).trim();
const defaultHook = execFileSync('git', ['rev-parse',
  '--git-path',
  'hooks/pre-commit'], {encoding: 'utf8'}).trim();
if ((hooks && hooks !== '.githooks') || (!hooks && existsSync(defaultHook))) {
  process.stderr.write('An existing Git hook configuration needs merging.\n');
  process.exit(1);
}
chmodSync('.githooks/pre-commit', 0o755);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
process.stdout.write('Installed local pre-commit checks.\n');
