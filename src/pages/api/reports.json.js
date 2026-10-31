import { reports } from '../../lib/data.mjs';

export function GET() {
  return new Response(JSON.stringify({ license: 'CC-BY-4.0', reports }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
