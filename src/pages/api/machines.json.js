import { machines } from '../../lib/data.mjs';

export function GET() {
  return new Response(JSON.stringify({ license: 'CC-BY-4.0', machines }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
