import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const lang = url.searchParams.get('lang') || undefined;
    // Respect configured model (e.g., gpt-4o-transcribe). No forced remap.
    const model = process.env.OPENAI_STT_MODEL || 'gpt-4o-transcribe';
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new NextResponse('Missing OPENAI_API_KEY', { status: 500 });
    }

    // Accept either raw body (Blob) or multipart/form-data with a "file" field
    let blob: Blob | null = null;
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = (form.get('file') || form.get('audio')) as Blob | null;
      if (file && file instanceof Blob) blob = file;
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

    // Normalize using original bytes and a safe filename via OpenAI.toFile
    const openai = new OpenAI({ apiKey });
    try {
      const buf = await blob.arrayBuffer();
      const btype = (blob.type || '').toLowerCase();
      const ext = btype.includes('webm')
        ? 'webm'
        : btype.includes('mp4')
        ? 'mp4'
        : btype.includes('mpeg') || btype.includes('mp3')
        ? 'mp3'
        : btype.includes('wav')
        ? 'wav'
        : 'webm';
      const normalizedBlob = new Blob([buf], { type: btype || 'audio/webm' });
      const file = await (OpenAI as any).toFile(normalizedBlob, `audio.${ext}`);

      const transcription = await openai.audio.transcriptions.create({
        file,
        model,
        language: lang || undefined,
      } as any);
      const text = (transcription as any)?.text ? String((transcription as any).text).trim() : '';
      return NextResponse.json({ text });
    } catch (err: any) {
      const msg = err?.message || 'OpenAI STT error';
      return new NextResponse(`OpenAI STT error: ${msg}`, { status: 502 });
    }
  } catch (e: any) {
    return new NextResponse(e?.message || 'STT route error', { status: 500 });
  }
}


