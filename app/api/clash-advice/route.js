import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { getClashAdvice } from '../../../lib/query.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const section = (searchParams.get('section') || 'A').toUpperCase();
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json({ ok: false, error: { message: 'Date parameter is required.' } }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const dataset = await getLiveDataset();
    const advice = getClashAdvice(dataset, section, date, today);

    return NextResponse.json({
      ok: true,
      data: advice,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
