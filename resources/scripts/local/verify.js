import {spawnSync} from 'node:child_process';

const steps = [
  ['format:check', ...process.argv.slice(2)],
  ['lint'],
  ['lint-pwa'],
  ['lint-local'],
  ['test-ci'],
  ['build-ci'],
  ['build-demo'],
  ['build-pwa'],
  ['doc']
];

for (const args of steps) {
  process.stdout.write(`\nLocal check: ${args[0]}\n`);
  const result = spawnSync('corepack', ['yarn', ...args], {stdio: 'inherit'});
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
