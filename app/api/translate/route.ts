import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_TRANSLATE_MODELS = ['gpt-4o-mini', 'gpt-4o'];
const DEFAULT_TRANSLATE_MODEL = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, target, model: requestedModel } = body || {};
    if (!text || !target) {
      return new NextResponse('Missing text or target', { status: 400 });
    }
    const model =
      requestedModel && ALLOWED_TRANSLATE_MODELS.includes(requestedModel)
        ? requestedModel
        : DEFAULT_TRANSLATE_MODEL;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return new NextResponse('Missing OPENAI_API_KEY', { status: 500 });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `Translate the following text to ${target}. Return only the translation.` },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new NextResponse(`OpenAI translate error: ${errText}`, { status: 502 });
    }
    const data = await resp.json();
    const translated = (data?.choices?.[0]?.message?.content || '').trim();
    return NextResponse.json({ translated });
  } catch (e: any) {
    return new NextResponse(e?.message || 'Translate route error', { status: 500 });
  }
}


