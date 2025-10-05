import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function mintSession() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
  }
  try {
    const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        input_audio_format: 'pcm16',
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json({
      client_secret: data?.client_secret?.value,
      expires_at: data?.client_secret?.expires_at,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Realtime session error' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest) {
  return mintSession();
}

export async function GET(_req: NextRequest) {
  return mintSession();
}
