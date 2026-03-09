import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

const VAD_THRESHOLD = Number(process.env.NEXT_PUBLIC_VAD_THRESHOLD ?? '0.5');
const VAD_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VAD_SILENCE_MS ?? '450');
const VAD_PREFIX_MS = Number(process.env.NEXT_PUBLIC_VAD_PREFIX_MS ?? '200');

console.log('[realtime-session] model:', REALTIME_MODEL, 'transcribe:', TRANSCRIBE_MODEL);

const SESSION_CONFIG = JSON.stringify({
  type: 'realtime',
  model: REALTIME_MODEL,
  audio: {
    input: {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model: TRANSCRIBE_MODEL },
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'server_vad',
        threshold: VAD_THRESHOLD,
        prefix_padding_ms: VAD_PREFIX_MS,
        silence_duration_ms: VAD_SILENCE_MS,
        create_response: false,
      },
    },
    output: { voice: 'alloy' },
  },
});

export async function POST(req: NextRequest) {
  if (!(req.headers.get('content-type') || '').includes('application/sdp')) {
    return NextResponse.json({ error: 'Expected application/sdp body' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
  }

  const sdp = await req.text();

  try {
    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set('session', SESSION_CONFIG);

    const resp = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });

    const answerSdp = await resp.text();
    if (!resp.ok) {
      console.error('[realtime-session] OpenAI error:', resp.status, answerSdp);
      return new NextResponse(answerSdp, { status: resp.status });
    }

    return new NextResponse(answerSdp, {
      status: 200,
      headers: { 'Content-Type': 'application/sdp' },
    });
  } catch (e: any) {
    console.error('[realtime-session] Error:', e?.message);
    return new NextResponse(e?.message || 'Realtime session error', { status: 500 });
  }
}
