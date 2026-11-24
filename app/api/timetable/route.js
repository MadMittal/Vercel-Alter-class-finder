import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { queryTimetable, queryUpcomingClashDays } from '../../../lib/query.js';
import { CFG, getTodayIST, addDaysISO, apiCacheHeaders } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('refresh') === '1';
    const section = (searchParams.get('section') || 'A').toUpperCase();
    const today = getTodayIST();
    const range = searchParams.get('range');
    let from = searchParams.get('from');
    let to = searchParams.get('to');

    if (range === 'all') {
      from = from || '2000-01-01';
      to = to || '2099-12-31';
    } else {
      from = from || today;
      to = to || addDaysISO(from, CFG.DEFAULT_RANGE_DAYS);
    }

    const dataset = await getLiveDataset(force);
    const days = queryTimetable(dataset, section, from, to);
    const upcomingClashes = queryUpcomingClashDays(dataset, section, today);

    return NextResponse.json(
      {
        ok: true,
        data: { section, today, from, to, days, upcomingClashes },
      },
      { headers: apiCacheHeaders(force) }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
