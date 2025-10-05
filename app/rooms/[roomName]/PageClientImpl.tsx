'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
  useParticipants,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  Track,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { startOpenAIRealtimeTranscriber } from '@/lib/useRealtimeTranscriber';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';
const CAPTIONS_MODE = (process.env.NEXT_PUBLIC_CAPTIONS_MODE || 'agent').toLowerCase();
const CAPTIONS_SRC = (process.env.NEXT_PUBLIC_CAPTIONS_SRC || 'lk').toLowerCase(); // 'fork' | 'lk'

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    // Pass through target language chosen on pre-join if available
    const targetSelect = document.getElementById('target-lang-prejoin') as HTMLSelectElement | null;
    const target = targetSelect?.value;
    if (target) {
      (window as any).__txat_target_lang = target;
      try { localStorage.setItem('txat_target_lang', target); } catch {}
    }
    // Capture STT input language (spoken language)
    const sttSelect = document.getElementById('stt-lang-prejoin') as HTMLSelectElement | null;
    const sttLang = sttSelect?.value;
    if (sttLang) {
      (window as any).__txat_stt_lang = sttLang;
    }
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            {/* Header logo to match home page */}
            <div className="header" style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <h1
                aria-label="Txat"
                style={{
                  fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
                  fontWeight: 600,
                  fontSize: '2rem',
                  letterSpacing: '0.02em',
                  color: '#ff6b5f',
                  margin: 0,
                }}
              >
                Txat
              </h1>
            </div>
            <PreJoin
              defaults={preJoinDefaults}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
            />
            {/* Language selector moved from home to pre-join */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label htmlFor="target-lang-prejoin">Translate to</label>
              <select id="target-lang-prejoin" defaultValue={(typeof window !== 'undefined' ? ((window as any).__txat_target_lang || new URLSearchParams(window.location.search).get('target') || (typeof localStorage !== 'undefined' ? localStorage.getItem('txat_target_lang') : null)) : null) ?? 'en'} style={{ padding: '4px 8px' }}>
                <option value="es">Spanish (es)</option>
                <option value="fr">French (fr)</option>
                <option value="de">German (de)</option>
                <option value="ja">Japanese (ja)</option>
                <option value="zh">Chinese (zh)</option>
                <option value="en">English (en)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label htmlFor="stt-lang-prejoin">Spoken language</label>
              <select id="stt-lang-prejoin" defaultValue={(typeof navigator !== 'undefined' ? (navigator.language || 'en').slice(0,2) : 'en')} style={{ padding: '4px 8px' }}>
                <option value="auto">Auto-detect</option>
                <option value="en">English (en)</option>
                <option value="es">Spanish (es)</option>
                <option value="fr">French (fr)</option>
                <option value="de">German (de)</option>
                <option value="it">Italian (it)</option>
                <option value="pt">Portuguese (pt)</option>
                <option value="ja">Japanese (ja)</option>
                <option value="zh">Chinese (zh)</option>
              </select>
            </div>
          </div>
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{ codec: props.codec, hq: props.hq }}
          roomName={props.roomName}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
  roomName: string;
}) {
  const forkedStreamRef = React.useRef<MediaStream | null>(null);
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      // Start captions depending on mode
      const captions = new URLSearchParams(window.location.search).get('captions') === '1';
      try {
        if (captions) {
          if (CAPTIONS_MODE === 'agent') {
            const target = (window as any).__txat_target_lang as string | undefined;
            const sttLang = (window as any).__txat_stt_lang as string | undefined;
            const url = new URL('/api/captions/start', window.location.origin);
            url.searchParams.set('roomName', props.roomName || (room as any)?.name || '');
            if (target) url.searchParams.set('target', target);
            if (sttLang && sttLang !== 'auto') url.searchParams.set('stt', sttLang);
            fetch(url.toString(), { method: 'POST' }).catch(() => {});
          } else {
            // client mode: will be handled by local transcriber
          }
        }
      } catch {}

      // Send participant language preferences to agent (with delay to ensure room is connected)
      setTimeout(async () => {
        try {
          const target = (window as any).__txat_target_lang as string | undefined;
          const sttLang = (window as any).__txat_stt_lang as string | undefined;
          console.log('Language prefs from window:', { target, sttLang, identity: room.localParticipant?.identity });
          
          if (target || sttLang) {
            const langPrefs = {
              type: 'language_prefs',
              participantId: room.localParticipant?.identity,
              sttLanguage: sttLang && sttLang !== 'auto' ? sttLang : undefined,
              targetLanguage: target,
              timestamp: new Date().toISOString()
            };
            console.log('Sending language preferences:', langPrefs);
            await room.localParticipant?.publishData?.(
              new TextEncoder().encode(JSON.stringify(langPrefs)),
              { reliable: true, topic: 'captions' as any }
            );
            console.log('Language preferences sent successfully');
          } else {
            console.log('No language preferences to send');
          }
        } catch (e) {
          console.error('Failed to send language preferences:', e);
        }
      }, 2000); // 2 second delay to ensure room is fully connected
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }

      // In client captions mode, start local transcriber after join
      if (captions && CAPTIONS_MODE === 'client') {
        (async () => {
          try {
            // Step 1: Forked mic stream support (no STT yet)
            if (CAPTIONS_SRC === 'fork') {
              try {
                const forked = await navigator.mediaDevices.getUserMedia({ audio: true });
                const forkTrack = forked.getAudioTracks()?.[0];
                forkedStreamRef.current = forked;
                console.log('Forked mic acquired for captions:', forkTrack?.label || '(no label)');
              } catch (e) {
                console.warn('Forked mic unavailable; falling back to LiveKit track for captions.', e);
              }
            }

            const sttLang = (window as any).__txat_stt_lang as string | undefined;
            const trackPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
            let mediaStreamTrack = (trackPub as any)?.audioTrack?.mediaStreamTrack || (trackPub as any)?.track?.mediaStreamTrack;
            if (!mediaStreamTrack && CAPTIONS_SRC !== 'fork') {
              try {
                const gum = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaStreamTrack = gum.getAudioTracks()?.[0];
              } catch {}
            }
            const stream: MediaStream | null = CAPTIONS_SRC === 'fork'
              ? (forkedStreamRef.current || null)
              : (mediaStreamTrack ? new MediaStream([mediaStreamTrack]) : null);
            if (!stream) {
              console.warn('Local transcriber: no microphone stream available');
              return;
            }
            // If using realtime fork mode, replace legacy batch STT with realtime streaming
            if (CAPTIONS_SRC === 'fork') {
              const s = forkedStreamRef.current;
              if (!s) return;
              let nextSid = 1;
              let currentSid = 0;
              let lastFinalText = '';
              const normalizeTail = (s: string) =>
                String(s)
                  .replace(/[\s]+/g, ' ')
                  .replace(/[.!?…]+$/g, '')
                  .trim()
                  .toLowerCase();
              const stop = startOpenAIRealtimeTranscriber(s, {
                onDelta: (text) => {
                  // Drop punctuation-only deltas to avoid stray '.' or '?' lines
                  if (/^[\s.!?…]+$/.test(text)) return;
                  const cleaned = String(text).trim();
                  if (!cleaned) return;
                  // Suppress carryover of last word(s) from the just-finalized line
                  if (lastFinalText) {
                    const tail = normalizeTail(lastFinalText).split(' ').slice(-3).join(' ');
                    const w = normalizeTail(cleaned);
                    if (w && (tail === w || tail.endsWith(' ' + w))) return;
                  }
                  console.log('ASR delta', cleaned);
                  if (currentSid === 0) currentSid = nextSid;
                  const payload = {
                    type: 'transcription',
                    speaker: room.localParticipant.identity,
                    text: cleaned,
                    final: false,
                    sentenceId: currentSid,
                    timestamp: new Date().toISOString(),
                  } as const;
                  room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'captions' as any }).catch(() => {});
                  try {
                    window.dispatchEvent(new CustomEvent('txat_captions_local', { detail: payload }));
                  } catch {}
                },
                onCompleted: async (text) => {
                  // Guard against punctuation-only completions (merge handled by model already)
                  if (/^[\s.!?…]+$/.test(text)) return;
                  lastFinalText = String(text).trim();
                  console.log('ASR final', lastFinalText);
                  if (currentSid === 0) currentSid = nextSid;
                  const payload = {
                    type: 'transcription',
                    speaker: room.localParticipant.identity,
                    text: lastFinalText,
                    final: true,
                    sentenceId: currentSid,
                    timestamp: new Date().toISOString(),
                  } as const;
                  room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'captions' as any }).catch(() => {});
                  try {
                    window.dispatchEvent(new CustomEvent('txat_captions_local', { detail: payload }));
                  } catch {}
                  const target = (window as any).__txat_target_lang as string | undefined;
                  if (target) {
                    try {
                      const tr = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastFinalText, target }) });
                      if (tr.ok) {
                        const tj = await tr.json();
                        const translatedText = String(tj?.translated || '').trim();
                        if (translatedText) {
                          const tmsg = {
                            type: 'translation',
                            speaker: room.localParticipant.identity,
                            text: lastFinalText,
                            translatedText,
                            sentenceId: currentSid,
                            final: true,
                            timestamp: new Date().toISOString(),
                          };
                          room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(tmsg)), { reliable: true, topic: 'captions' as any }).catch(() => {});
                          try {
                            window.dispatchEvent(new CustomEvent('txat_captions_local', { detail: tmsg }));
                          } catch {}
                        }
                      }
                    } catch {}
                  }
                  nextSid = currentSid + 1;
                  currentSid = 0; // reset for next sentence
                },
              });
              // Mirror mute/unmute to fork track
              const toggleFork = () => {
                const t = forkedStreamRef.current?.getAudioTracks?.()[0];
                if (!t) return;
                const pub: any = room.localParticipant.getTrackPublication(Track.Source.Microphone);
                const muted = pub?.isMuted || pub?.muted || !room.localParticipant.isMicrophoneEnabled;
                t.enabled = !muted;
              };
              const onMute = (_pub:any, participant:any)=>{ if(participant?.isLocal) toggleFork(); };
              const onUnmute = (_pub:any, participant:any)=>{ if(participant?.isLocal) toggleFork(); };
              room.on(RoomEvent.TrackMuted, onMute);
              room.on(RoomEvent.TrackUnmuted, onUnmute);
              toggleFork();
              // Cleanup on disconnect
              room.on(RoomEvent.Disconnected, () => {
                try { stop(); } catch {}
                room.off(RoomEvent.TrackMuted, onMute);
                room.off(RoomEvent.TrackUnmuted, onUnmute);
                try { (window as any).__txat_captions_active = false; } catch {}
              });
              return; // do not run legacy MediaRecorder path
            }

            const supportedMime = typeof MediaRecorder !== 'undefined' &&
              (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : MediaRecorder.isTypeSupported('audio/mp4')
                ? 'audio/mp4'
                : undefined);
            const rec = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
            let nextSid = 1;
            let currentSid = 0;
            const chunkQueue: Blob[] = [];
            rec.ondataavailable = async (e) => {
              if (!e.data || e.data.size === 0) return;
              // Skip while mic muted/disabled
              const pubAny: any = room.localParticipant.getTrackPublication(Track.Source.Microphone);
              const micEnabled = room.localParticipant.isMicrophoneEnabled && !pubAny?.isMuted && !pubAny?.muted;
              if (!micEnabled) return;
              // Ignore very small chunks to avoid OpenAI decode errors
              if (e.data.size < 8000) return;

              // Batch multiple chunks into a single file (improves container validity)
              chunkQueue.push(e.data);
              const totalSize = chunkQueue.reduce((n, b) => n + (b as any).size, 0);
              if (chunkQueue.length < 3 && totalSize < 120000) return; // wait for ~3 chunks or ~120KB

              const type = (e.data.type || 'audio/webm');
              const ext = type.includes('webm') ? 'webm' : type.includes('mp4') ? 'mp4' : type.includes('wav') ? 'wav' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : 'webm';
              const batched = new Blob(chunkQueue.splice(0, chunkQueue.length), { type });

              // Send to STT proxy
              const form = new FormData();
              form.append('file', new File([batched], `clip.${ext}`, { type }));
              const u = new URL('/api/stt', window.location.origin);
              if (sttLang && sttLang !== 'auto') u.searchParams.set('lang', sttLang);
              const r = await fetch(u.toString(), { method: 'POST', body: form });
              if (!r.ok) return;
              const j = await r.json();
              const text = String(j?.text || '').trim();
              if (!text) return;
              // Publish interim as active; mark as final when punctuation or short phrase
              const ends = /[.!?…]$/.test(text);
              const words = text.split(/\s+/).filter(Boolean).length;
              const isVeryShort = words <= 3 && text.length <= 20;
              const final = Boolean(ends || isVeryShort);
              const payload = {
                type: 'transcription',
                speaker: room.localParticipant.identity,
                text,
                final,
                sentenceId: final ? ++currentSid : currentSid || (currentSid = nextSid),
                timestamp: new Date().toISOString(),
              };
              room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'captions' as any }).catch(() => {});
              if (final) {
                const target = (window as any).__txat_target_lang as string | undefined;
                if (target) {
                  const tr = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, target }) });
                  if (tr.ok) {
                    const tj = await tr.json();
                    const translatedText = String(tj?.translated || '').trim();
                    if (translatedText) {
                      const tmsg = {
                        type: 'translation',
                        speaker: room.localParticipant.identity,
                        text,
                        translatedText,
                        sentenceId: currentSid,
                        final: true,
                        timestamp: new Date().toISOString(),
                      };
                      room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(tmsg)), { reliable: true, topic: 'captions' as any }).catch(() => {});
                    }
                  }
                }
              }
            };
            // Use slightly larger chunks to improve decoder stability
            rec.start(1600); // ~1.6s chunks
          } catch (err) {
            console.error('Local transcriber failed:', err);
          }
        })();
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  const chatFormatter = React.useCallback(
    (message: string) => {
      const base = formatChatMessageLinks(message);
      const isTranscript = message.startsWith('[Transcript]');
      const isTranslation = message.startsWith('[Translation]');
      if (!isTranscript && !isTranslation) return base;
      const label = isTranscript ? 'Transcript' : 'Translation';
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid var(--lk-border-color, #2a2a2a)',
              opacity: 0.8,
            }}
          >
            {label}
          </span>
          {base}
        </span>
      );
    },
    []
  );

  return (
    <div className="lk-room-container" style={{ position: 'relative' }}>
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <CaptionsChatBridge room={room} />
        <HideAgentTiles />
        <VideoConference
          chatMessageFormatter={chatFormatter}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <CopyLinkButtonInControlBar />
        <TranscribingPillInControlBar />
        <CaptionsTilesOverlay room={room} />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}

function CaptionsChatBridge(props: { room: Room }) {
  const { room } = props;
  React.useEffect(() => {
    const onData = (
      payload: Uint8Array,
      _participant?: any,
      _kind?: any,
      topic?: string,
    ) => {
      // Bridge only captions topic messages
      if (topic !== 'captions') return;
      try {
        const json = JSON.parse(new TextDecoder().decode(payload));
        if (json?.type === 'transcription') {
          const text = `[Transcript] ${json.speaker ?? 'Speaker'}: ${json.text ?? ''}`;
          room.localParticipant.sendChatMessage(text).catch(() => void 0);
        } else if (json?.type === 'translation') {
          const text = `[Translation] ${json.speaker ?? 'Speaker'}: ${json.translatedText ?? ''}`;
          room.localParticipant.sendChatMessage(text).catch(() => void 0);
        }
      } catch {
        // ignore non-JSON
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);
  return null;
}

function isAgentParticipant(p: any): boolean {
  try {
    if (typeof p?.metadata === 'string' && p.metadata) {
      const meta = JSON.parse(p.metadata);
      if (meta?.role === 'agent' || meta?.subtype === 'captions') return true;
    }
  } catch {}
  const name: string | undefined = (p as any)?.name;
  const identity: string | undefined = (p as any)?.identity;
  return Boolean(
    (!!name && name.toLowerCase().includes('captions')) ||
      (!!identity && identity.startsWith('captions-agent'))
  );
}

function TranscribingPillInControlBar() {
  const participants = useParticipants();
  const agentPresent = participants.some((p) => isAgentParticipant(p));
  const [container, setContainer] = React.useState<Element | null>(null);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector('.lk-control-bar');
    if (el) {
      setContainer(el);
      return;
    }
    const obs = new MutationObserver(() => {
      const found = document.querySelector('.lk-control-bar');
      if (found) {
        setContainer(found);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  const pill = (
    <div
      aria-label="Transcribing"
      style={{
        fontSize: 14,
        padding: '8px 14px',
        borderRadius: 8,
        userSelect: 'none',
        order: -1,
        marginRight: 12,
        border: agentPresent ? '2px solid #e5484d' : '1px solid rgba(255,255,255,0.2)',
        color: agentPresent ? '#e5484d' : 'rgba(255,255,255,0.8)',
        background: agentPresent ? 'rgba(229,72,77,0.08)' : 'rgba(255,255,255,0.06)',
      }}
    >
      {agentPresent ? 'Transcribing' : 'Transcribing (off)'}
    </div>
  );
  if (container) return createPortal(pill, container);
  return null;
}

function CopyLinkButtonInControlBar() {
  const [container, setContainer] = React.useState<Element | null>(null);
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [blink, setBlink] = React.useState(0);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector('.lk-control-bar');
    if (el) {
      setContainer(el);
      return;
    }
    const obs = new MutationObserver(() => {
      const found = document.querySelector('.lk-control-bar');
      if (found) {
        setContainer(found);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // Create a stable mount point between Share Screen and Chat
  React.useEffect(() => {
    if (!container) return;
    const ensureMount = () => {
      // Prefer to insert before Chat button
      const chatBtn = container.querySelector('button[aria-label="Chat"], button[aria-label="Toggle chat"]');
      // Alternatively, after Share Screen
      const shareBtn = container.querySelector('button[aria-label*="share" i], button[aria-label*="screen" i]');
      let m = mount;
      if (!m) {
        m = document.createElement('span');
        m.style.display = 'inline-flex';
        m.style.alignItems = 'center';
        setMount(m);
      }
      if (chatBtn && chatBtn.parentElement && m.parentElement !== chatBtn.parentElement) {
        chatBtn.parentElement.insertBefore(m, chatBtn);
      } else if (shareBtn && shareBtn.parentElement) {
        // insert after share button
        const parent = shareBtn.parentElement;
        if (shareBtn.nextSibling) parent.insertBefore(m, shareBtn.nextSibling);
        else parent.appendChild(m);
      } else if (!m.parentElement) {
        container.appendChild(m);
      }
    };
    ensureMount();
    const obs = new MutationObserver(() => ensureMount());
    obs.observe(container, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [container, mount]);

  const handleCopy = React.useCallback(() => {
    try {
      const href = window.location.href;
      navigator.clipboard.writeText(href).then(() => {
        // Blink border red twice
        setBlink(1);
        setTimeout(() => setBlink(0), 150);
        setTimeout(() => setBlink(1), 300);
        setTimeout(() => setBlink(0), 450);
      });
    } catch {}
  }, []);

  const copyIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );

  const button = (
    <button className="lk-button" onClick={handleCopy} aria-label="Copy meeting link" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: blink ? '2px solid #e5484d' : undefined }}>
      {copyIcon}
      <span>Link</span>
    </button>
  );

  if (mount) return createPortal(button, mount);
  return null;
}

function HideAgentTiles() {
  const participants = useParticipants();
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const hide = () => {
      // 1) Hide agent tile defensively (if still rendered)
      document.querySelectorAll('.lk-participant-tile').forEach((el) => {
        const txt = el.textContent || '';
        if (/captions agent/i.test(txt)) {
          (el as HTMLElement).style.display = 'none';
        }
      });
      // 2) Adjust grid columns to the number of non-agent participants
      const nonAgentCount = participants.filter((p) => !isAgentParticipant(p)).length;
      const grid = document.querySelector('.lk-grid-layout') as HTMLElement | null;
      if (grid && nonAgentCount > 0) {
        // Force override with !important to win against inline updates
        grid.style.setProperty('--lk-col-count', String(Math.min(nonAgentCount, 4)), 'important');
      }
    };
    hide();
    // Re-apply whenever the grid mutates (e.g., layout recalculates)
    const grid = document.querySelector('.lk-grid-layout');
    const obs = new MutationObserver(hide);
    if (grid) obs.observe(grid, { attributes: true, childList: true, subtree: true });
    const bodyObs = new MutationObserver(hide);
    bodyObs.observe(document.body, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      bodyObs.disconnect();
    };
  }, [participants]);
  return null;
}

function CaptionsTilesOverlay(props: { room: Room }) {
  const { room } = props;
  type Block = { id: number; ts: number; text: string };
  type SpeakerState = {
    blocks: Block[]; // transcript finalized blocks
    tblocks: Block[]; // translation finalized blocks
    active?: { id: number; ts: number; text: string }; // live interim for current sentence
    partial?: string; // reserved if we ever pass interim text via LiveKit
    lastIdx: number; // cumulative length tracker if needed in future
  };
  const [byIdentity, setByIdentity] = React.useState<Record<string, SpeakerState>>({});
  const participants = useParticipants();
  const nextIdRef = React.useRef(1);

  const resolveIdentity = React.useCallback(
    (speaker: string | undefined): string | undefined => {
      if (!speaker) return undefined;
      const base = String(speaker).split('__')[0].toLowerCase();
      const exact = participants.find((p) => p.identity === speaker);
      if (exact) return exact.identity;
      const starts = participants.find((p) => p.identity?.startsWith(base));
      if (starts) return starts.identity;
      const byName = participants.find((p) => p.name?.toLowerCase() === base);
      if (byName?.identity) return byName.identity;
      // Do NOT fallback to local identity; keep the original speaker identity so we can attach later
      return speaker;
    },
    [participants],
  );

  React.useEffect(() => {
    const onData = (
      payload: Uint8Array,
      _p?: any,
      _k?: any,
      topic?: string,
    ) => {
      // Ignore echoes of messages we just dispatched locally
      if (_p?.isLocal) return;
      const text = new TextDecoder().decode(payload);
      // Debug: log incoming captions payloads (temporary)
      try {
        // eslint-disable-next-line no-console
        console.debug('captions data', { topic, text });
      } catch {}
      // Primary: JSON on 'captions'
      if (topic === 'captions') {
        try {
          const json = JSON.parse(text);
          if (json?.type === 'transcription') {
            const id = resolveIdentity(json.speaker);
            const slice = String(json.text ?? '').trim();
            if (id && slice) {
              setByIdentity((prev) => {
                const now = Date.now();
                const cur = prev[id] ?? { blocks: [], tblocks: [], lastIdx: 0 };
                const sid = typeof json.sentenceId === 'number' ? (json.sentenceId as number) : undefined;
                // If we have a sentenceId, treat non-final as active and final as a commit
                if (sid != null) {
                  if (json.final) {
                    const idx = cur.blocks.findIndex((b) => b.id === sid);
                    const blocks = cur.blocks.slice();
                    if (idx !== -1) blocks[idx] = { id: sid, ts: now, text: slice };
                    else blocks.push({ id: sid, ts: now, text: slice });
                    const next: SpeakerState = { ...cur, blocks };
                    if (cur.active?.id === sid) next.active = undefined;
                    return { ...prev, [id]: next };
                  } else {
                    return { ...prev, [id]: { ...cur, active: { id: sid, ts: now, text: slice } } };
                  }
                }
                // Fallback heuristic merge (older agents)
                const blocks = cur.blocks;
                const last = blocks[blocks.length - 1];
                // If the new slice is a strict extension/rewrite of the last line, replace last
                if (last && (slice.startsWith(last.text) || last.text.startsWith(slice))) {
                  const next = blocks.slice();
                  next[next.length - 1] = { ...last, ts: now, text: slice };
                  return { ...prev, [id]: { ...cur, blocks: next } };
                }
                const isTiny = slice.split(/\s+/).length < 4;
                const endsSentence = /[.!?…]$/.test(last?.text || '');
                const gapShort = last ? now - last.ts < 1200 : false;
                if (last && (gapShort || !endsSentence) && isTiny) {
                  const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                  return { ...prev, [id]: { ...cur, blocks: [...blocks.slice(0, -1), merged] } };
                }
                const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
                return { ...prev, [id]: { ...cur, blocks: [...blocks, newBlock] } };
              });
            }
          }
          else if (json?.type === 'translation') {
            const id = resolveIdentity(json.speaker);
            const slice = String(json.translatedText ?? json.text ?? '').trim();
            const sid = typeof json.sentenceId === 'number' ? (json.sentenceId as number) : undefined;
            if (id && slice) {
              setByIdentity((prev) => {
                const now = Date.now();
                const cur = prev[id] ?? { blocks: [], tblocks: [], lastIdx: 0 };
                // If agent provided a sentenceId, upsert by that id to avoid splits
                if (sid != null) {
                  const idx = cur.tblocks.findIndex((b) => b.id === sid);
                  const tblocks = cur.tblocks.slice();
                  if (idx !== -1) {
                    tblocks[idx] = { ...tblocks[idx], ts: now, text: slice };
                  } else {
                    tblocks.push({ id: sid, ts: now, text: slice });
                  }
                  return { ...prev, [id]: { ...cur, tblocks } };
                }
                // Fallback heuristic merge (older agents)
                const blocks = cur.tblocks;
                const last = blocks[blocks.length - 1];
                const isTiny = slice.split(/\s+/).length < 4;
                const endsSentence = /[.!?…]$/.test(last?.text || '');
                const gapShort = last ? now - last.ts < 1200 : false;
                if (last && (gapShort || !endsSentence) && isTiny) {
                  const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                  return { ...prev, [id]: { ...cur, tblocks: [...blocks.slice(0, -1), merged] } };
                }
                const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
                return { ...prev, [id]: { ...cur, tblocks: [...blocks, newBlock] } };
              });
            }
          }
          return;
        } catch {}
      }
      // Fallback: plain chat style lines
      if (text.startsWith('[Transcript]')) {
        const m = text.match(/^\[Transcript\]\s+([^:]+):\s*(.*)$/);
        if (m) {
          const id = resolveIdentity(m[1]);
          const slice = (m[2] || '').trim();
          if (id && slice) {
            setByIdentity((prev) => {
              const now = Date.now();
              const cur = prev[id] ?? { blocks: [], tblocks: [], lastIdx: 0 };
              const blocks = cur.blocks;
              const last = blocks[blocks.length - 1];
              const isTiny = slice.split(/\s+/).length < 4;
              const endsSentence = /[.!?…]$/.test(last?.text || '');
              const gapShort = last ? now - last.ts < 1200 : false;
              if (last && (gapShort || !endsSentence) && isTiny) {
                const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                return { ...prev, [id]: { ...cur, blocks: [...blocks.slice(0, -1), merged] } };
              }
              const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
              return { ...prev, [id]: { ...cur, blocks: [...blocks, newBlock] } };
            });
          }
        }
      }
      if (text.startsWith('[Translation]')) {
        const m = text.match(/^\[Translation\]\s+([^:]+):\s*(.*)$/);
        if (m) {
          const id = resolveIdentity(m[1]);
          const slice = (m[2] || '').trim();
          if (id && slice) {
            setByIdentity((prev) => {
              const now = Date.now();
              const cur = prev[id] ?? { blocks: [], tblocks: [], lastIdx: 0 };
              const blocks = cur.tblocks;
              const last = blocks[blocks.length - 1];
              const isTiny = slice.split(/\s+/).length < 4;
              const endsSentence = /[.!?…]$/.test(last?.text || '');
              const gapShort = last ? now - last.ts < 1200 : false;
              if (last && (gapShort || !endsSentence) && isTiny) {
                const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                return { ...prev, [id]: { ...cur, tblocks: [...blocks.slice(0, -1), merged] } };
              }
              const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
              return { ...prev, [id]: { ...cur, tblocks: [...blocks, newBlock] } };
            });
          }
        }
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    // Also listen to local synthetic events (realtime mode)
    const onLocal = (e: any) => {
      try {
        const json = e?.detail;
        if (!json) return;
        // Mirror the same handling as topic==='captions'
        const speaker = json.speaker || room.localParticipant?.identity;
        const wrapped = JSON.stringify({ ...json, speaker });
        onData(new TextEncoder().encode(wrapped), undefined, undefined, 'captions');
      } catch {}
    };
    try { window.addEventListener('txat_captions_local' as any, onLocal as any); } catch {}
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      try { window.removeEventListener('txat_captions_local' as any, onLocal as any); } catch {}
    };
  }, [room]);

  // Only render overlays when captions are enabled via URL (?captions=1) or runtime flag
  const captionsEnabled = new URLSearchParams(window.location.search).get('captions') === '1' || (typeof window !== 'undefined' && (window as any).__txat_captions_active === true);
  if (!captionsEnabled) return null;
  return (
    <>
      {Object.entries(byIdentity).map(([identity, v]) => (
        <CaptionPortal key={identity} identity={identity} blocks={v.blocks} tblocks={v.tblocks} active={v.active} />)
      )}
    </>
  );
}

function CaptionPortal(props: { identity: string; blocks: { id: number; ts: number; text: string }[]; tblocks: { id: number; ts: number; text: string }[]; active?: { id: number; ts: number; text: string } }) {
  const { identity, blocks, tblocks, active } = props;
  const participants = useParticipants();
  const [container, setContainer] = React.useState<Element | null>(null);
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  const translationRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const escId = (window as any).CSS?.escape
      ? (window as any).CSS.escape(identity)
      : identity.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const tryFind = () => {
      // 1) Preferred: tile exposes data-lk-identity
      let tile: Element | null = document.querySelector(
        `.lk-participant-tile[data-lk-identity="${escId}"]`,
      );

      // 2) Fallback: find by participant-name span when tile lacks identity attrs
      if (!tile) {
        const p = participants.find((pp) => pp.identity === identity);
        const displayName = p?.name ?? identity.split('__')[0];
        if (displayName) {
          const escName = (window as any).CSS?.escape
            ? (window as any).CSS.escape(displayName)
            : displayName.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
          const nameEl =
            document.querySelector(
              `.lk-participant-name[data-lk-participant-name="${escName}"]`,
            ) ||
            Array.from(document.querySelectorAll('.lk-participant-name')).find(
              (el) => el.textContent?.trim().toLowerCase() === displayName.toLowerCase(),
            ) || null;
          if (nameEl) {
            tile = (nameEl as HTMLElement).closest('.lk-participant-tile');
          }
        }
      }

      if (tile) {
        const h = tile as HTMLElement;
        if (getComputedStyle(h).position === 'static') {
          h.style.position = 'relative';
          h.style.overflow = 'visible';
        }
        setContainer(h);
      } else {
        // If not found yet, keep waiting for future mutations without falling back to local tile
      }
    };
    tryFind();
    const obs = new MutationObserver(tryFind);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [identity, participants]);

  React.useEffect(() => {
    if (transcriptRef.current) {
      const el = transcriptRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [blocks]);

  React.useEffect(() => {
    if (translationRef.current) {
      const el = translationRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [tblocks]);

  if (!container) return null;
  return createPortal(
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 9999,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(0,0,0,0.55)',
        color: 'white',
        pointerEvents: 'auto',
        fontSize: 15,
        lineHeight: 1.4,
        textAlign: 'left',
        minHeight: 110,
        maxHeight: 250,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      {/* Transcript box (4 lines tall) */}
      <div
        ref={transcriptRef}
        style={{
          width: '100%',
          overflowY: 'auto',
          paddingRight: 4,
          maxHeight: 112,
          borderTop: '1px solid rgba(255,255,255,0.15)'
        }}
      >
        {blocks.length === 0 && !active ? (
          <div style={{ opacity: 0.8 }}>Transcript will appear here…</div>
        ) : (
          blocks.map((b) => (
            <div key={b.id} style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', marginRight: 8 }}>
                [{new Date(b.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}]
              </span>
              <span>{b.text}</span>
            </div>
          ))
        )}
        {active && (
          <div key={`active-${active.id}`} style={{ whiteSpace: 'pre-wrap', marginBottom: 6, opacity: 0.9, fontStyle: 'italic' }}>
            <span style={{ color: 'rgba(255,255,255,0.6)', marginRight: 8 }}>
              [{new Date(active.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}]
            </span>
            <span>{active.text}</span>
          </div>
        )}
      </div>

      {/* Translation box (4 lines tall) */}
      <div
        ref={translationRef}
        style={{
          width: '100%',
          overflowY: 'auto',
          paddingRight: 4,
          maxHeight: 112,
        }}
      >
        {tblocks.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Translation will appear here…</div>
        ) : (
          tblocks.map((b) => (
            <div key={`t-${b.id}`} style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', marginRight: 8 }}>
                [{new Date(b.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}]
              </span>
              <span style={{ opacity: 0.95 }}>{b.text}</span>
            </div>
          ))
        )}
      </div>
    </div>,
    container,
  );
}

// (test overlay removed; using real transcript overlays below)
