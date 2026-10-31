import { apps, lastUpdated } from '../../lib/data.mjs';

export function GET() {
  const body = {
    license: 'CC-BY-4.0',
    updated: lastUpdated,
    apps: apps.map(({ reports, hasConflict, ...app }) => ({
      ...app,
      reportCount: reports.length,
      hasConflict,
    })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
