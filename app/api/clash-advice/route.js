import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { getClashAdvice } from '../../../lib/query.js';
import { getTodayIST } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const section = (searchParams.get('section') || 'A').toUpperCase();
    const date = searchParams.get('date');
    const sessionId = searchParams.get('sessionId') || null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: { message: 'Valid YYYY-MM-DD date parameter is required.' } }, { status: 400 });
    }

    const today = getTodayIST();
    const dataset = await getLiveDataset();
    const advice = getClashAdvice(dataset, section, date, today, sessionId);

    return NextResponse.json({
      ok: true,
      data: advice,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
