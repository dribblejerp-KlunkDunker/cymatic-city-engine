// node:test reporter that prints only failures and one totals line, so a full run costs a few lines of
// context instead of hundreds.  Usage: node --test --test-reporter=./test/quiet-reporter.mjs test/*.test.mjs
export default async function* quiet(source) {
  let pass = 0, fail = 0, skip = 0, todo = 0;
  const started = Date.now();
  for await (const { type, data } of source) {
    if (type === 'test:pass' && data.details?.type !== 'suite') {
      if (data.skip) skip++; else if (data.todo) todo++; else pass++;
    } else if (type === 'test:fail' && data.details?.type !== 'suite') {
      fail++;
      const err = data.details?.error;
      const cause = err?.cause ?? err;
      const where = data.file ? `${data.file.replace(process.cwd() + '/', '')}${data.line ? `:${data.line}` : ''}` : '';
      const msg = String(cause?.message ?? cause ?? 'failed').split('\n').slice(0, 6).join('\n    ');
      yield `FAIL ${data.name}${where ? `  (${where})` : ''}\n    ${msg}\n`;
    }
  }
  yield `${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}${todo ? `, ${todo} todo` : ''} in ${Math.round((Date.now() - started) / 1000)} s\n`;
}
