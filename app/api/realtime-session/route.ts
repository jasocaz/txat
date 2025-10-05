import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey });
    // Create a Realtime session for PCM16 audio and gpt-4o-transcribe transcription
    const session: any = await openai.realtime.sessions.create({
      model: 'gpt-4o-realtime-preview-2024-12-17',
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'gpt-4o-transcribe',
      },
    } as any);

    return NextResponse.json({
      client_secret: session.client_secret,
      expires_at: session.expires_at,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Realtime session error' }, { status: 500 });
  }
}
