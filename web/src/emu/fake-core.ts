// The fake core the emulator's tests run on (index.test.ts, watchdog.test.ts). Not a
// test itself, and imported by nothing the page ships.
import type { CoreModule } from './index';

// A fake core: a 1 MiB heap with EWRAM at 0x1000 and IWRAM at 0x50000, a file map,
// and a log of every call, so the wrapper's bookkeeping can be checked without wasm.
export function fakeCore() {
  const heap = new Uint8Array(1 << 20);
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let cb: Parameters<CoreModule['addCoreCallbacks']>[0] = {};
  const m: CoreModule = {
    FSInit: async () => {},
    FSSync: async () => {
      calls.push('sync');
    },
    FS: {
      writeFile: (p, d) => void files.set(p, d),
      readFile: (p) => {
        const f = files.get(p);
        if (!f) throw new Error('ENOENT');
        return f;
      },
      unlink: (p) => {
        if (!files.delete(p)) throw new Error('ENOENT');
      },
      stat: (p) => {
        if (!files.has(p)) throw new Error('ENOENT');
        return {};
      },
      readdir: (dir) => ['.', '..', ...[...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1))],
    },
    loadGame: (p) => {
      calls.push(`load ${p}`);
      return files.has(p);
    },
    quitGame: () => calls.push('quit'),
    pauseGame: () => calls.push('pause'),
    resumeGame: () => calls.push('resume'),
    buttonPress: (n) => calls.push(`press ${n}`),
    buttonUnpress: (n) => calls.push(`release ${n}`),
    setVolume: () => {},
    getVolume: () => 1,
    setFastForwardMultiplier: (x) => calls.push(`speed ${x}`),
    saveState: () => true,
    loadState: () => true,
    screenshot: (p) => {
      files.set(p!, new Uint8Array([0x89, 0x50]));
      return true;
    },
    addCoreCallbacks: (c) => {
      cb = c;
    },
    _brWramPtr: () => 0x1000,
    _brIwramPtr: () => 0x50000,
    HEAPU8: heap,
  };
  return { m, heap, files, calls, frame: () => cb.videoFrameEndedCallback?.(), crash: () => cb.coreCrashedCallback?.() };
}
