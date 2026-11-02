import { softwareIndex } from '../../lib/data.mjs';

export function GET() {
  const body = {
    license: 'MIT',
    sources: ['https://github.com/Linaro/works-on-woa', 'https://github.com/microsoft/winget-pkgs'],
    note: 'From other catalogs and not checked by this site. Programs this site covers are in apps.json.',
    software: softwareIndex,
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
