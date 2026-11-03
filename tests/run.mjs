// Node runner: `node tests/run.mjs` (exit code 1 on failure).
import { run } from './harness.js';
import './all.test.js';
import './extract.test.js';

const results = run();
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    ${r.error}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
