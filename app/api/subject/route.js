import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { querySubjectSessions } from '../../../lib/query.js';
import { SECTIONS, getTodayIST } from '../../../lib/config.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const course = searchParams.get('course');
    const sessionNo = searchParams.get('sessionNo');
    const section = (searchParams.get('section') || 'A').toUpperCase();

    if (!SECTIONS.includes(section)) {
      return NextResponse.json({ ok: false, error: { message: `Invalid section: ${section}` } }, { status: 400 });
    }
    if (!course || !sessionNo) {
      return NextResponse.json({ ok: false, error: { message: 'course and sessionNo are required.' } }, { status: 400 });
    }

    const today = getTodayIST();
    const dataset = await getLiveDataset();
    const rows = querySubjectSessions(dataset, course, sessionNo, section, today);

    return NextResponse.json({
      ok: true,
      data: { course, sessionNo: parseInt(sessionNo, 10), section, rows },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
