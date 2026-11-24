import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { queryTimetable } from '../../../lib/query.js';
import { CFG } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const section = (searchParams.get('section') || 'A').toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const from = searchParams.get('from') || today;

    let to = searchParams.get('to');
    if (!to) {
      const [y, m, d] = from.split('-').map(Number);
      const toDate = new Date(Date.UTC(y, m - 1, d + CFG.DEFAULT_RANGE_DAYS));
      to = toDate.toISOString().slice(0, 10);
    }

    const dataset = await getLiveDataset();
    const days = queryTimetable(dataset, section, from, to);

    return NextResponse.json({
      ok: true,
      data: { section, from, to, days },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
