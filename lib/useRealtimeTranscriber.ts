/*
  Minimal OpenAI Realtime transcriber starter used by txat.
  - Opens a Realtime session using /api/realtime-session to get client_secret
  - Streams the provided MediaStream (mic) to OpenAI via WebRTC
  - Emits transcription delta and completed events via callbacks
  - Returns a stop() function to tear down the peer connection
*/

export type TranscriberCallbacks = {
  onDelta?: (text: string) => void;
  onCompleted?: (text: string) => void;
  onError?: (message: string) => void;
  onStarted?: () => void;
};

export function startOpenAIRealtimeTranscriber(
  stream: MediaStream,
  callbacks: TranscriberCallbacks = {}
): () => void {
  const { onDelta, onCompleted, onError, onStarted } = callbacks;

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let dc: RTCDataChannel | null = null;

  // Add mic track
  const track = stream.getAudioTracks()[0];
  if (track) pc.addTrack(track, stream);

  // Data channel for control + events
  dc = pc.createDataChannel('signaling');
  dc.onopen = () => {
    try {
      const sessionConfig = {
        type: 'session.update',
        input_audio_format: 'pcm16',
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.58,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
          idle_timeout_ms: null,
          create_response: false,
          interrupt_response: true,
        },
      };
      dc?.send(JSON.stringify(sessionConfig));
      onStarted?.();
    } catch (e: any) {
      onError?.(String(e?.message || e));
    }
  };

  dc.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const t = String(
        msg?.transcript ?? msg?.delta ?? msg?.text ?? ''
      ).replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (msg?.type === 'conversation.item.input_audio_transcription.delta') {
        onDelta?.(t);
        return;
      }
      if (msg?.type === 'conversation.item.input_audio_transcription.completed') {
        onCompleted?.(t);
        return;
      }
    } catch {}
  };

  // Start SDP exchange
  (async () => {
    try {
      const tokenResp = await fetch('/api/realtime-session', { method: 'POST' });
      if (!tokenResp.ok) throw new Error(await tokenResp.text());
      const { client_secret } = await tokenResp.json();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answerResp = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            Authorization: `Bearer ${client_secret}`,
          },
          body: offer.sdp || '',
        }
      );
      if (!answerResp.ok) throw new Error(await answerResp.text());
      const answerSdp = await answerResp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (e: any) {
      onError?.(String(e?.message || e));
    }
  })();

  return () => {
    try {
      dc?.close();
    } catch {}
    try {
      pc.getSenders().forEach((s) => s.track && s.track.stop());
      pc.close();
    } catch {}
  };
}


