// node:test reporter that prints only failures and one totals line, so a full run costs a few lines of
// context instead of hundreds.  Usage: node --test --test-reporter=./test/quiet-reporter.mjs test/*.test.mjs
export default async function* quiet(source) {
  let pass = 0, fail = 0, skip = 0, todo = 0;
  const started = Date.now();
  const stderr = new Map(); // per test file: what it wrote to stderr (a file that cannot load says why only there)
  for await (const { type, data } of source) {
    if (type === 'test:stderr') {
      stderr.set(data.file, ((stderr.get(data.file) ?? '') + data.message).slice(-4000));
    } else if (type === 'test:pass' && data.details?.type !== 'suite') {
      if (data.skip) skip++; else if (data.todo) todo++; else pass++;
    } else if (type === 'test:fail' && data.details?.type !== 'suite') {
      fail++;
      const err = data.details?.error;
      const cause = err?.cause ?? err;
      const where = data.file ? `${data.file.replace(process.cwd() + '/', '')}${data.line ? `:${data.line}` : ''}` : '';
      let msg = String(cause?.message ?? cause ?? 'failed').split('\n').slice(0, 6).join('\n    ');
      // the file itself failed (import error, crash): node reports only "test failed", the reason is on stderr
      if (data.name === data.file && stderr.has(data.file)) msg += '\n    ' + stderr.get(data.file).trim().split('\n').filter((l) => l.trim() && !/^\s+at /.test(l)).slice(0, 8).join('\n    ');
      yield `FAIL ${data.name === data.file ? where.replace(/:\d+$/, '') : data.name}${where && data.name !== data.file ? `  (${where})` : ''}\n    ${msg}\n`;
    }
  }
  yield `${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}${todo ? `, ${todo} todo` : ''} in ${Math.round((Date.now() - started) / 1000)} s\n`;
}
