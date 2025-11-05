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
        model: 'gpt-4o-mini-realtime-preview-2024-12-17',
        voice: 'alloy',
        input_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
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

export async function POST(req: NextRequest) {
  if ((req.headers.get('content-type') || '').includes('application/sdp')) {
    // Forward SDP offer to OpenAI and return answer SDP
    const body = await req.text();
    const clientSecret = req.headers.get('x-openai-client-secret') || req.nextUrl.searchParams.get('client_secret');
    if (!clientSecret) return new NextResponse('Missing client_secret', { status: 400 });
    try {
      const resp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          Authorization: `Bearer ${clientSecret}`,
        },
        body,
      });
      const text = await resp.text();
      return new NextResponse(text, { status: resp.status, headers: { 'Content-Type': 'application/sdp' } });
    } catch (e: any) {
      return new NextResponse(e?.message || 'SDP forward error', { status: 500 });
    }
  }
  return mintSession();
}

export async function GET(_req: NextRequest) {
  return mintSession();
}
