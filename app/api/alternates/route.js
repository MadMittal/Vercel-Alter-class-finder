import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { queryAlternates } from '../../../lib/query.js';
import { SECTIONS, getTodayIST, apiCacheHeaders } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const section = (searchParams.get('section') || 'A').toUpperCase();
    const sessionId = searchParams.get('sessionId');
    const showPast = searchParams.get('showPast') === 'true';

    if (!SECTIONS.includes(section)) {
      return NextResponse.json({ ok: false, error: { message: `Invalid section: ${section}` } }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: { message: 'sessionId is required.' } }, { status: 400 });
    }

    const today = getTodayIST();
    const dataset = await getLiveDataset();
    const result = queryAlternates(dataset, section, sessionId, { showPast, todayISO: today });

    return NextResponse.json(
      {
        ok: true,
        data: result,
      },
      { headers: apiCacheHeaders(false) }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
