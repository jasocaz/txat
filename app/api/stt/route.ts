import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const lang = url.searchParams.get('lang') || undefined;
    // Use Whisper by default for /audio/transcriptions compatibility
    const envModel = process.env.OPENAI_STT_MODEL || 'whisper-1';
    const model = /gpt-4o/i.test(envModel) ? 'whisper-1' : envModel;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new NextResponse('Missing OPENAI_API_KEY', { status: 500 });
    }

    // Accept either raw body (Blob) or multipart/form-data with a "file" field
    let blob: Blob | null = null;
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (file && file instanceof Blob) {
        blob = file;
      }
    } else {
      blob = await req.blob();
    }

    if (!blob) {
      return new NextResponse('No audio provided', { status: 400 });
    }
    // Guard against tiny chunks that often fail decode
    if ((blob as any).size && (blob as any).size < 6000) {
      return NextResponse.json({ text: '' });
    }

    // Normalize to a plain 'audio/webm' filename; avoid codec params in type header
    const safeFile = new File([blob], 'audio.webm', { type: 'audio/webm' });

    // Use OpenAI SDK for robust multipart encoding
    const openai = new OpenAI({ apiKey });
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: safeFile,
        model,
        language: lang || undefined,
        response_format: 'text',
      } as any);
      const text = transcription ? String(transcription as any).trim?.() || String(transcription) : '';
      return NextResponse.json({ text });
    } catch (err: any) {
      const msg = err?.message || 'OpenAI STT error';
      return new NextResponse(`OpenAI STT error: ${msg}`, { status: 502 });
    }
  } catch (e: any) {
    return new NextResponse(e?.message || 'STT route error', { status: 500 });
  }
}


