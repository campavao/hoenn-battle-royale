// What the browser's processes cost while a spec watches (POK-247): CPU time from CDP --
// the battery stand-in a desktop can give -- and resident memory from the OS, since
// `performance.memory` sees the JS heap only and neither 256 MB wasm core is in it.
//
// Chromium only (SystemInfo is a browser-level CDP domain). The renderer is the busiest
// one between two snapshots: the spec has one page open, and the core's pthreads are
// workers inside that renderer, so their time is in its number too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { Browser, CDPSession } from '@playwright/test';

export interface ProcSnapshot {
  at: number;
  /** pid -> its type and CPU-seconds so far. */
  cpu: Map<number, { type: string; cpu: number }>;
}

export interface ProcCost {
  seconds: number;
  /** CPU-seconds a second, by kind of process: 1.0 is one core flat out. */
  renderer: number;
  gpu: number;
  browser: number;
  other: number;
  rendererPid: number | null;
  /** The renderer's resident memory, MB, read from the OS; null where it cannot be. */
  rssMb: number | null;
}

export async function processes(browser: Browser): Promise<CDPSession> {
  return browser.newBrowserCDPSession();
}

export async function snapshot(cdp: CDPSession): Promise<ProcSnapshot> {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return { at: Date.now(), cpu: new Map(processInfo.map((p) => [p.id, { type: p.type, cpu: p.cpuTime }])) };
}

export function cost(from: ProcSnapshot, to: ProcSnapshot): ProcCost {
  const seconds = Math.max(0.001, (to.at - from.at) / 1000);
  const out: ProcCost = { seconds, renderer: 0, gpu: 0, browser: 0, other: 0, rendererPid: null, rssMb: null };
  let busiest = -1;
  for (const [pid, p] of to.cpu) {
    const used = p.cpu - (from.cpu.get(pid)?.cpu ?? 0);
    if (p.type === 'renderer') {
      if (used > busiest) {
        busiest = used;
        out.rendererPid = pid;
        out.renderer = used / seconds;
      }
    } else if (p.type === 'GPU' || p.type === 'gpu') out.gpu += used / seconds;
    else if (p.type === 'browser') out.browser += used / seconds;
    else out.other += used / seconds;
  }
  if (out.rendererPid !== null) out.rssMb = rssMb(out.rendererPid);
  return out;
}

/** Resident memory of a process, MB: /proc on Linux, tasklist's working set on
 *  Windows, ps elsewhere. Null if the OS will not say. */
export function rssMb(pid: number): number | null {
  try {
    if (process.platform === 'linux') {
      const m = /VmRSS:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
      return m ? Math.round(Number(m[1]) / 1024) : null;
    }
    if (process.platform === 'win32') {
      const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const m = /"([\d,.\s]+) K"\s*$/m.exec(row.trim());
      return m ? Math.round(Number(m[1].replace(/[^\d]/g, '')) / 1024) : null;
    }
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    return Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

/** `renderer 1.23 cpu/s · gpu 0.40 · rss 612 MB` */
export function costLine(c: ProcCost): string {
  const rss = c.rssMb === null ? 'rss ?' : `rss ${c.rssMb} MB`;
  return `renderer ${c.renderer.toFixed(2)} cpu/s · gpu ${c.gpu.toFixed(2)} · browser ${c.browser.toFixed(2)} · ${rss}`;
}
