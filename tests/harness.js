// Minimal test harness that runs both in the browser (tests/index.html)
// and in Node (`node tests/run.mjs`), so the prototype needs no toolchain.
const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

export function run() {
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, error: err.message };
    }
  });
}
