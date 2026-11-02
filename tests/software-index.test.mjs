import { describe, expect, it } from 'vitest';
import {
  curatedWithNewArm64, hasOwnArm64Build, mergeIndex, newlyNative, normalizeWoa, parseWingetTitle,
  validateIndexEntry, WOA_REPO, wingetDir, yamlField,
} from '../shared/software-index.mjs';

const project = (over) => ({
  name: 'App', publisher: 'Co', type: 'application', compatibility: 'yes', emulationType: 'native',
  versionFrom: '1.0', lastUpdated: '2026-03-02', link: 'https://a.example', validation: ['qualcomm'], ...over,
});

describe('normalizeWoa', () => {
  it('maps results', () => {
    const [a, b, c] = normalizeWoa([
      project({ name: 'A' }),
      project({ name: 'B', emulationType: 'emulation' }),
      project({ name: 'C', compatibility: 'no', emulationType: 'na' }),
    ]);
    expect([a.status, b.status, c.status]).toEqual(['native', 'prism', 'broken']);
  });

  it('leaves out entries with no clear result', () => {
    expect(normalizeWoa([project({ compatibility: 'unknown', emulationType: 'unknown' }), project({ emulationType: 'unknown' })])).toEqual([]);
  });

  it('keeps who tested it and whether it is a game', () => {
    const [e] = normalizeWoa([project({ type: 'game', validation: ['qualcomm', 'nvidia'] })]);
    expect(e).toMatchObject({ nvidia: true, game: true });
    expect(normalizeWoa([project()])[0]).not.toHaveProperty('nvidia');
  });

  it('links to the page that states the result', () => {
    expect(normalizeWoa([project({ slug: 'tailscale' })])[0].url).toBe('https://worksonwoa.com/en/applications/tailscale/');
    expect(normalizeWoa([project({ slug: 'celeste', type: 'game' })])[0].url).toBe('https://worksonwoa.com/en/games/celeste/');
  });

  it('never builds a link from an odd slug', () => {
    for (const slug of ['../evil', 'a/b', 'a b', undefined]) {
      expect(normalizeWoa([project({ slug })])[0].url).toBe(WOA_REPO);
    }
  });
});

describe('winget manifests', () => {
  it.each([
    ['New version: Tailscale.Tailscale version 1.104.4 (#468427)', { id: 'Tailscale.Tailscale', version: '1.104.4' }],
    ['New package: a.b version 2', { id: 'a.b', version: '2' }],
    ['Update: OpenTubeX.OpenTubeX to 0.37.3 (#468406)', { id: 'OpenTubeX.OpenTubeX', version: '0.37.3' }],
    ['Remove version: a.b version 2', undefined],
    ['Fix the readme', undefined],
  ])('reads %s', (title, want) => expect(parseWingetTitle(title)).toEqual(want));

  it('builds the manifest folder', () => {
    expect(wingetDir('Tailscale.Tailscale', '1.104.4')).toBe('manifests/t/Tailscale/Tailscale/1.104.4');
  });

  const yaml = (...pairs) => `Installers:\n${pairs.map(([a, u]) => `- Architecture: ${a}\n  InstallerUrl: ${u}`).join('\n')}\n`;

  it('accepts a file made for Arm64', () => {
    expect(hasOwnArm64Build(yaml(['x64', 'https://a/x64.msi'], ['arm64', 'https://a/arm64.msi']))).toBe(true);
  });

  it('rejects one file listed for every architecture', () => {
    expect(hasOwnArm64Build(yaml(['x64', 'https://a/setup.exe'], ['arm64', 'https://a/setup.exe']))).toBe(false);
  });

  it('accepts Tailscale, which has both a shared installer and its own Arm64 file', () => {
    expect(hasOwnArm64Build(yaml(['x64', 'https://a/full.exe'], ['arm64', 'https://a/full.exe'], ['x64', 'https://a/amd64.msi'], ['arm64', 'https://a/arm64.msi']))).toBe(true);
  });

  it('rejects manifests with no Arm64 build', () => {
    expect(hasOwnArm64Build(yaml(['x64', 'https://a/x64.msi']))).toBe(false);
  });

  it('reads a field and strips quotes', () => {
    expect(yamlField('PackageName: "Tail scale"\nPublisher: Co', 'PackageName')).toBe('Tail scale');
    expect(yamlField('Publisher: Co', 'PackageName')).toBeUndefined();
  });
});

describe('mergeIndex', () => {
  const woa = normalizeWoa([
    project({ name: 'Emulated', emulationType: 'emulation', validation: ['nvidia'] }),
    project({ name: 'Native' }),
    project({ name: 'Tailscale' }),
  ]);
  const w = { name: 'Emulated', version: '2', date: '2026-11-01', url: 'https://w.example', publisher: 'W' };

  it('lets a new Arm64 build override an emulated result, and drops the old test mark', () => {
    const e = mergeIndex({ woa, winget: [w], curated: [] }).find((x) => x.name === 'Emulated');
    expect(e).toMatchObject({ status: 'native', version: '2', url: 'https://w.example', checked: '2026-11-01' });
    expect(e).not.toHaveProperty('nvidia');
  });

  it('adds programs only winget knows', () => {
    const list = mergeIndex({ woa, winget: [{ ...w, name: 'Brand New' }], curated: [] });
    expect(list.find((x) => x.name === 'Brand New').status).toBe('native');
  });

  it('keeps a result that was already native', () => {
    const e = mergeIndex({ woa, winget: [{ ...w, name: 'Native' }], curated: [] }).find((x) => x.name === 'Native');
    expect(e.url).toBe(WOA_REPO);
  });

  it('leaves out what the site already covers, ignoring case and punctuation', () => {
    const list = mergeIndex({ woa, winget: [], curated: [{ name: 'TAIL-SCALE' }, { name: 'Other', aliases: ['native'] }] });
    expect(list.map((x) => x.name)).toEqual(['Emulated']);
  });

  it('flags a curated entry that winget says now has an Arm64 build', () => {
    const curated = [{ name: 'emulated', status: 'prism' }, { name: 'Native', status: 'native' }];
    expect(curatedWithNewArm64(curated, [w, { ...w, name: 'Native' }]).map((x) => x.app.name)).toEqual(['emulated']);
  });

  it('lists only what became native', () => {
    const after = mergeIndex({ woa, winget: [w], curated: [] });
    expect(newlyNative(woa, after).map((x) => x.name)).toEqual(['Emulated']);
  });
});

describe('validateIndexEntry', () => {
  it('accepts a good entry', () => expect(validateIndexEntry({ name: 'A', status: 'native', url: 'https://a.example' })).toEqual([]));
  it.each([
    [{ name: '', status: 'native', url: 'https://a.example' }, 'name'],
    [{ name: 'A', status: 'maybe', url: 'https://a.example' }, 'status'],
    [{ name: 'A', status: 'native', url: 'javascript:alert(1)' }, 'url'],
  ])('rejects %j', (entry, field) => expect(validateIndexEntry(entry)).toContain(field));
});
