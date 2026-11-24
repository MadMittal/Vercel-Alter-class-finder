import { NextResponse } from 'next/server';
import { getLiveDataset } from '../../../lib/sheets.js';
import { CFG } from '../../../lib/config.js';

export const revalidate = 60;

export async function GET() {
  try {
    const dataset = await getLiveDataset();
    return NextResponse.json({
      ok: true,
      data: {
        status: 'HEALTHY',
        platform: 'Vercel Serverless Edge',
        termLabel: CFG.TERM_LABEL,
        counts: dataset.meta?.counts || null,
        generatedAt: dataset.meta?.generatedAt || null,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: 500 });
  }
}
