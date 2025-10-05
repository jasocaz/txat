import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const lang = url.searchParams.get('lang') || undefined;
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

    // Normalize file type and filename so OpenAI accepts it
    const blobType = (blob.type || '').toLowerCase();
    const type = blobType || 'audio/webm';
    const ext = type.includes('webm')
      ? 'webm'
      : type.includes('mp4')
      ? 'mp4'
      : type.includes('mpeg') || type.includes('mp3')
      ? 'mp3'
      : type.includes('wav')
      ? 'wav'
      : 'webm';
    // Re-wrap as a File with explicit type + filename
    const file = new File([blob], `audio.${ext}`, { type });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);
    if (lang) formData.append('language', lang);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new NextResponse(`OpenAI STT error: ${errText}`, { status: 502 });
    }
    const data = await resp.json();
    const text = (data?.text || '').trim();
    return NextResponse.json({ text, raw: data });
  } catch (e: any) {
    return new NextResponse(e?.message || 'STT route error', { status: 500 });
  }
}


