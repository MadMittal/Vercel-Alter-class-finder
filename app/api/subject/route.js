import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { querySubjectSessions } from '../../../lib/query.js';

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const course = searchParams.get('course');
    const sessionNo = searchParams.get('sessionNo');
    const section = (searchParams.get('section') || 'A').toUpperCase();

    if (!course || !sessionNo) {
      return NextResponse.json({ ok: false, error: { message: 'course and sessionNo are required.' } }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const dataset = await getLiveDataset();
    const rows = querySubjectSessions(dataset, course, sessionNo, section, today);

    return NextResponse.json({
      ok: true,
      data: { course, sessionNo: parseInt(sessionNo, 10), rows },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 400 });
  }
}
