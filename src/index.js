import path from 'path';
import fs from'fs';
import vm from 'vm';
import {createHash} from 'crypto';

import resolve from 'resolve';
import chokidar from 'chokidar';
import {transform} from 'babel-core';
import {sync as mkdirp} from 'mkdirp';

let called = false;
export default function configure(entrypoint, overrideRequires, opts) {
  if (called) throw new Error('You can only use babel-live once per project');
  called = true;

  opts = opts || {};
  const babelCache = opts.babelCache ? path.resolve(opts.babelCache) : null;
  if (babelCache) {
    delete opts.babelCache;
    mkdirp(babelCache);
  }
  const fallbackRequire = opts.fallbackRequire;
  if (fallbackRequire) {
    delete opts.fallbackRequire;
  }

  if (opts.sourceMap !== false) opts.sourceMap = "inline";

  let requireInProgress = false;
  let extraRequireNeeded = false;
  let requireCache = {};
  // filename => fn(module, exports, require, __filename, __dirname)
  const moduleCache = {};
  function invalidate(filename) {
    console.log('detected file change: ' + filename);
    requireCache = {};
    moduleCache[filename] = null;
    doRequire();
  }
  function doRequire() {
    if (!requireInProgress) {
      requireInProgress = true;
      try {
        babelRequire(entrypoint);
      } catch (ex) {
        if (fallbackRequire) {
          console.error(ex.stack);
          babelRequire(fallbackRequire);
        } else {
          throw ex;
        }
      }
      setTimeout(() => {
        requireInProgress = false;
        if (extraRequireNeeded) {
          extraRequireNeeded = false;
          doRequire();
        }
      }, 2000);
    } else {
      extraRequireNeeded = true;
    }
  }

  const watching = {};
  function watch(filename) {
    if (watching[filename]) return;
    watching[filename] = true;
    const w = chokidar.watch(filename, {
      persistent: true,
      usePolling: true,
      interval: 100,
    });
    w.on('error', err => {
      console.log('error watching file');
      console.log('probably nothing to worry about');
      console.log(err.message);
    });
    w.on('change', () => invalidate(filename));
  }

  function babelRequire(filename) {
    filename = path.resolve(filename);
    if (!/\.js$/.test(filename)) {
      return require(filename);
    }
    if (!/node_modules/.test(filename)) {
      watch(filename);
    }
    if (requireCache[filename]) return requireCache[filename];
    let fn = moduleCache[filename];
    if (!fn) {
      const src = (
        !/node_modules/.test(filename)
        ? babelLoad(filename)
        : fs.readFileSync(filename, 'utf8')
      );
      fn = vm.runInThisContext(
        '(function(module,exports,require,__filename,__dirname){' + src + '\n})',
        filename
      );
      moduleCache[filename] = fn;
    }
    requireCache[filename] = {};
    const mod = {
      exports: requireCache[filename],
    };
    function proxiedRequire(id) {
      if (overrideRequires[id]) {
        return overrideRequires[id];
      }

      if (resolve.isCore(id)) {
        return require(id);
      }

      const p = resolve.sync(id, {
        basedir: path.dirname(filename),
        extensions: ['.js', '.json', '.node'],
      });

      return babelRequire(p);
    }
    proxiedRequire.resolve = (id) => {
      return resolve.sync(id, {
        basedir: path.dirname(filename),
        extensions: ['.js', '.json', '.node'],
      });
    };
    const sandbox = {
      'module': mod,
      'exports': mod.exports,
      'require': proxiedRequire,
      '__filename': filename,
      '__dirname': path.dirname(filename),
    };
    fn(
      sandbox.module,
      sandbox.exports,
      sandbox.require,
      sandbox.__filename,
      sandbox.__dirname
    );
    return requireCache[filename] = mod.exports;
  }

  function babelLoad(filename) {
    const src = fs.readFileSync(filename, 'utf8');
    opts.filename = filename;
    let hash;
    if (babelCache) {
      hash = createHash('sha1').update(src).digest('hex');
      try {
        return fs.readFileSync(path.join(babelCache, hash + '.js'), 'utf8');
      } catch (ex) {
        if (ex.code !== 'ENOENT') {
          throw ex;
        }
      }
    }
    const result = transform(src, opts).code;
    if (babelCache) {
      fs.writeFileSync(path.join(babelCache, hash + '.js'), result);
    }
    return result;
  }

  return babelRequire(entrypoint);
}
