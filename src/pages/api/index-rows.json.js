import { otherIndex } from '../../lib/data.mjs';

// The home page lists these after its own and NVIDIA's rows. Tuples keep the file small.
export function GET() {
  const rows = otherIndex.map((e) => [e.name, e.publisher ?? '', e.status, e.version ?? '', e.checked ?? '', e.url, e.category ?? '']);
  return new Response(JSON.stringify(rows), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
