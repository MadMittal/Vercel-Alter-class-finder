import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { CFG, apiCacheHeaders } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET() {
  try {
    const dataset = await getLiveDataset();
    return NextResponse.json(
      {
        ok: true,
        data: {
          status: 'HEALTHY',
          platform: 'Live Timetable Auto-Sync',
          termLabel: CFG.TERM_LABEL,
          counts: dataset.meta?.counts || null,
          sourceFormat: dataset.meta?.sourceFormat || null,
          refreshMinutes: Math.round(CFG.CACHE_TTL_MS / 60000),
          generatedAt: dataset.meta?.generatedAt || null,
        },
      },
      { headers: apiCacheHeaders(false) }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 500 });
  }
}
