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
  onStatusChange?: (status: 'live' | 'reconnecting' | 'paused') => void;
};

const VAD_THRESHOLD = Number(process.env.NEXT_PUBLIC_VAD_THRESHOLD ?? '0.5');
const VAD_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VAD_SILENCE_MS ?? '450');
const VAD_PREFIX_MS = Number(process.env.NEXT_PUBLIC_VAD_PREFIX_MS ?? '200');

export function startOpenAIRealtimeTranscriber(
  stream: MediaStream,
  callbacks: TranscriberCallbacks = {}
): () => void {
  const { onDelta, onCompleted, onError, onStarted, onStatusChange } = callbacks;

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let dc: RTCDataChannel | null = null;

  // Add mic track
  const track = stream.getAudioTracks()[0];
  try {
    // Reduce capture-side latency by disabling heavy processing
    track.applyConstraints?.({ echoCancellation: false as any, noiseSuppression: false as any, autoGainControl: false as any });
    // Hint to encoder/stack that this is speech
    (track as any).contentHint = 'speech';
  } catch {}
  if (track) pc.addTrack(track, stream);

  // Data channel for control + events
  const setStatus = (s: 'live' | 'reconnecting' | 'paused') => {
    try { onStatusChange?.(s); } catch {}
  };

  dc = pc.createDataChannel('signaling');
  dc.onopen = () => {
    try {
      // The session was already configured with input_audio_transcription during creation
      // We just need to update turn_detection settings
      const sessionConfig = {
        type: 'session.update',
        session: {
          turn_detection: {
            type: 'server_vad',
            threshold: VAD_THRESHOLD,
            prefix_padding_ms: VAD_PREFIX_MS,
            silence_duration_ms: VAD_SILENCE_MS,
            create_response: false,
          },
        },
      };
      dc?.send(JSON.stringify(sessionConfig));
      onStarted?.();
    } catch (e: any) {
      onError?.(String(e?.message || e));
    }
  };

  dc.onerror = (err) => {
    onError?.(String(err));
  };

  dc.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      
      // Handle transcription events
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
      
      // Handle errors
      if (msg?.type === 'error') {
        onError?.(String(msg?.error?.message || 'Unknown error'));
      }
    } catch (e) {
      // Silently ignore malformed messages
    }
  };

  // Map connection states to status
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

  // Start SDP exchange
  (async () => {
    try {
      setStatus('reconnecting');
      const tokenResp = await fetch('/api/realtime-session', { method: 'POST' });
      if (!tokenResp.ok) throw new Error(await tokenResp.text());
      const { client_secret } = await tokenResp.json();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answerResp = await fetch(`/api/realtime-session?client_secret=${encodeURIComponent(client_secret)}`, {
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


