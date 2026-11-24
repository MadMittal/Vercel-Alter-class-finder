import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { SECTIONS, CFG } from '../../../lib/config.js';

export const revalidate = 300; // Edge cache for 5 minutes

export async function GET() {
  try {
    const dataset = await getLiveDataset();
    const today = new Date().toISOString().slice(0, 10);

    return NextResponse.json({
      ok: true,
      data: {
        sections: SECTIONS,
        courses: dataset.courses || [],
        today: today,
        defaultRangeDays: CFG.DEFAULT_RANGE_DAYS,
        termLabel: CFG.TERM_LABEL,
        counts: dataset.meta?.counts || null,
        generatedAt: dataset.meta?.generatedAt || null,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 500 });
  }
}
