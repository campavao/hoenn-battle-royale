// The dev server serves a patched ROM, so what it hands out and to whom is pinned here
// (POK-330 #26): /@fs/ reaches the repo root and nothing above it, and only HBR_LAN=1
// puts it on the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relative, resolve, isAbsolute } from 'node:path';
import type { UserConfig } from 'vite';

const repoRoot = resolve(__dirname, '../..');

async function config(): Promise<UserConfig> {
  vi.resetModules();
  return (await import('../vite.config')).default as UserConfig;
}

const inside = (dir: string, root: string) => {
  const rel = relative(root, resolve(dir));
  return !rel.startsWith('..') && !isAbsolute(rel);
};

afterEach(() => vi.unstubAllEnvs());

describe('dev server', () => {
  it('serves /@fs/ from the repo root and nowhere above it', async () => {
    vi.stubEnv('HBR_ROM', '');
    const allow = (await config()).server?.fs?.allow ?? [];
    expect(allow.map((d) => resolve(d))).toEqual([repoRoot]);
  });

  it("adds HBR_ROM's own folder when a run points at a ROM elsewhere", async () => {
    const elsewhere = resolve(repoRoot, '..', 'roms', 'pokeemerald.gba');
    vi.stubEnv('HBR_ROM', elsewhere);
    const allow = (await config()).server?.fs?.allow ?? [];
    expect(allow.map((d) => resolve(d))).toEqual([repoRoot, resolve(elsewhere, '..')]);
    expect(allow.filter((d) => !inside(d, repoRoot))).toEqual([resolve(elsewhere, '..')]);
  });

  it('listens on localhost only, unless HBR_LAN=1', async () => {
    vi.stubEnv('HBR_LAN', '');
    let c = await config();
    expect(c.server?.host).toBe(false);
    expect(c.preview?.host).toBe(false);

    vi.stubEnv('HBR_LAN', '1');
    c = await config();
    expect(c.server?.host).toBe(true);
    expect(c.preview?.host).toBe(true);
  });
});
