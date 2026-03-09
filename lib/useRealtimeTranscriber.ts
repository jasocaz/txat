/*
  Minimal OpenAI Realtime transcriber used by txat.
  - Streams the provided MediaStream (mic) to OpenAI via WebRTC
  - Uses the GA unified interface: single SDP exchange via /api/realtime-session
  - VAD and transcription are configured server-side in the session config
  - Emits transcription delta and completed events via callbacks
  - Returns a stop() function to tear down the peer connection
*/

export type TranscriberCallbacks = {
  onDelta?: (text: string) => void;
  onCompleted?: (text: string) => void;
  onError?: (message: string) => void;
  onStarted?: () => void;
  onStatusChange?: (status: 'live' | 'reconnecting' | 'paused') => void;
  transcribeModel?: string;
};

export function startOpenAIRealtimeTranscriber(
  stream: MediaStream,
  callbacks: TranscriberCallbacks = {}
): () => void {
  const { onDelta, onCompleted, onError, onStarted, onStatusChange, transcribeModel } = callbacks;

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let dc: RTCDataChannel | null = null;

  // Add mic track
  const track = stream.getAudioTracks()[0];
  try {
    track.applyConstraints?.({ echoCancellation: false as any, noiseSuppression: false as any, autoGainControl: false as any });
    (track as any).contentHint = 'speech';
  } catch {}
  if (track) pc.addTrack(track, stream);

  const setStatus = (s: 'live' | 'reconnecting' | 'paused') => {
    try { onStatusChange?.(s); } catch {}
  };

  dc = pc.createDataChannel('oai-events');
  dc.onopen = () => {
    onStarted?.();
  };

  dc.onerror = (err) => {
    onError?.(String(err));
  };

  dc.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg?.type === 'conversation.item.input_audio_transcription.delta') {
        const t = String(msg?.delta ?? '').replace(/\s+/g, ' ').trim();
        if (t) {
          onDelta?.(t);
        }
        return;
      }
      if (msg?.type === 'conversation.item.input_audio_transcription.completed') {
        const t = String(msg?.transcript ?? '').replace(/\s+/g, ' ').trim();
        if (t) {
          onCompleted?.(t);
        }
        return;
      }

      if (msg?.type === 'error') {
        onError?.(String(msg?.error?.message || 'Unknown error'));
      }
    } catch (e) {
      // Silently ignore malformed messages
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') setStatus('live');
    else if (s === 'connecting') setStatus('reconnecting');
    else if (s === 'failed' || s === 'disconnected' || s === 'closed') setStatus('paused');
  };
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === 'failed' || s === 'disconnected') setStatus('reconnecting');
  };

  // Single-step SDP exchange via the GA unified interface
  (async () => {
    try {
      setStatus('reconnecting');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sessionUrl = transcribeModel
        ? `/api/realtime-session?transcribeModel=${encodeURIComponent(transcribeModel)}`
        : '/api/realtime-session';
      const answerResp = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp || '',
      });
      if (!answerResp.ok) throw new Error(await answerResp.text());

      const answerSdp = await answerResp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (e: any) {
      onError?.(String(e?.message || e));
      setStatus('paused');
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
    setStatus('paused');
  };
}
