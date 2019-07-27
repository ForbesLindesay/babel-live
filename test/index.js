import assert from 'assert';
import {writeFileSync} from 'fs';
import test from 'testit';
import {sync as mkdir} from 'mkdirp';
import load from '../src';

function sleep(time) {
  return new Promise((resolve, reject) => { setTimeout(resolve, time); });
}

mkdir(__dirname + '/workspace');
function write(filename, data) {
  writeFileSync(__dirname + '/workspace' + filename, data);
}
write('/index.js', 'import add from "./add";export default function () { return add("version ", "1"); }');
write('/fallback.js', 'export default function () { return "fallback"; }');
write('/add.ts', 'export default function add(a: string, b: string) { return a + b; }');
let file;
let lastError;
load(
  __dirname + '/workspace/index.js',
  {},
  {fallbackRequire: __dirname + '/workspace/fallback.js', resolveOptions: {extensions: ['.ts']}},
  _file => file = _file,
  _err => lastError = _err,
);

test('it updates when the file changes', async () => {
  assert(file.default() === 'version 1');
  await sleep(1000);
  write('/index.js', 'export default function () { return "version 2"; }');
  await sleep(2000);
  assert(file.default() === 'version 2');
});

test('it provides a clear error when there is a syntax error and recovers afterwards', async () => {
  assert(file.default() === 'version 2');
  write('/index.js', 'export defalt function () { return "version 3"; }');
  await sleep(2000);
  assert(file.default() === 'fallback');
  assert(lastError.indexOf('workspace') !== -1);
  write('/index.js', 'export default function () { return "version 4"; }');
  await sleep(2000);
  assert(file.default() === 'version 4');
});

test('it provides a clear error when there is a runtime error on load and recovers afterwards', async () => {
  assert(file.default() === 'version 4');
  write('/index.js', 'throw new Error("foo");\nexport default function () { return "version 5"; }');
  await sleep(2000);
  assert(file.default() === 'fallback');
  write('/index.js', 'export default function () { return "version 6"; }');
  await sleep(2000);
  assert(file.default() === 'version 6');
});
test('exit', () => {
  process.exit(0);
});
