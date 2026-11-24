import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { SECTIONS, CFG, getTodayIST, apiCacheHeaders } from '../../../lib/config.js';

export const revalidate = 300; // Edge cache for 5 minutes

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('refresh') === '1';
    const dataset = await getLiveDataset(force);
    const today = getTodayIST();

    return NextResponse.json(
      {
        ok: true,
        data: {
          sections: SECTIONS,
          courses: dataset.courses || [],
          today,
          minDate: dataset.meta?.minDate || null,
          maxDate: dataset.meta?.maxDate || null,
          defaultRangeDays: CFG.DEFAULT_RANGE_DAYS,
          termLabel: CFG.TERM_LABEL,
          counts: dataset.meta?.counts || null,
          sourceFormat: dataset.meta?.sourceFormat || null,
          generatedAt: dataset.meta?.generatedAt || null,
        },
      },
      { headers: apiCacheHeaders(force) }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 500 });
  }
}
