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
    // Capture per-user model preferences
    const translateModelSelect = document.getElementById('translate-model-prejoin') as HTMLSelectElement | null;
    const translateModel = translateModelSelect?.value;
    if (translateModel) {
      (window as any).__txat_translate_model = translateModel;
      try { localStorage.setItem('txat_translate_model', translateModel); } catch {}
    }
    const transcribeModelSelect = document.getElementById('transcribe-model-prejoin') as HTMLSelectElement | null;
    const transcribeModel = transcribeModelSelect?.value;
    if (transcribeModel) {
      (window as any).__txat_transcribe_model = transcribeModel;
      try { localStorage.setItem('txat_transcribe_model', transcribeModel); } catch {}
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
              <label htmlFor="transcribe-model-prejoin">Transcription model</label>
              <select id="transcribe-model-prejoin" defaultValue={(typeof window !== 'undefined' ? ((window as any).__txat_transcribe_model || (typeof localStorage !== 'undefined' ? localStorage.getItem('txat_transcribe_model') : null)) : null) ?? 'gpt-4o-mini-transcribe'} style={{ padding: '4px 8px' }}>
                <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe (default)</option>
                <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label htmlFor="translate-model-prejoin">Translation model</label>
              <select id="translate-model-prejoin" defaultValue={(typeof window !== 'undefined' ? ((window as any).__txat_translate_model || (typeof localStorage !== 'undefined' ? localStorage.getItem('txat_translate_model') : null)) : null) ?? 'gpt-4o-mini'} style={{ padding: '4px 8px' }}>
                <option value="gpt-4o-mini">gpt-4o-mini (default)</option>
                <option value="gpt-4o">gpt-4o</option>
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

  // Expose room globally for debugging regardless of connection state
  React.useEffect(() => {
    try { (globalThis as any).__txat_room = room; } catch {}
  }, [room]);

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
        .then(() => {
          try { (globalThis as any).__txat_room = room; } catch {}
        })
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
          
          if (target || sttLang) {
            const langPrefs = {
              type: 'language_prefs',
              participantId: room.localParticipant?.identity,
              sttLanguage: sttLang && sttLang !== 'auto' ? sttLang : undefined,
              targetLanguage: target,
              timestamp: new Date().toISOString()
            };
            await room.localParticipant?.publishData?.(
              new TextEncoder().encode(JSON.stringify(langPrefs)),
              { reliable: true, topic: 'captions' as any }
            );
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
                let currentInterimText = '';
                let finalizeTimer: any = null;
                let finalizedSid: number | null = null;
              const normalizeTail = (s: string) =>
                String(s)
                  .replace(/[\s]+/g, ' ')
                  .replace(/[.!?…]+$/g, '')
                  .trim()
                  .toLowerCase();
                const commitFinalFromInterim = () => {
                  if (currentSid === 0) return;
                  if (finalizedSid === currentSid) return;
                  const text = String(currentInterimText || '').trim();
                  if (!text) return;
                  finalizedSid = currentSid;
                  lastFinalText = text;
                  const sid = currentSid;
                  const speaker = room.localParticipant.identity;
                  const payload = {
                    type: 'transcription',
                    speaker,
                    text,
                    final: true,
                    sentenceId: sid,
                    timestamp: new Date().toISOString(),
                  } as const;
                  room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'captions' as any }).catch(() => {});
                  try {
                    window.dispatchEvent(new CustomEvent('txat_captions_local', { detail: payload }));
                  } catch {}
                  nextSid = sid + 1;
                  currentSid = 0;
                  finalizedSid = null;
                  currentInterimText = '';
                  const target = (window as any).__txat_target_lang as string | undefined;
                  if (target) {
                    (async () => {
                      try {
                        const tr = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, target, model: (window as any).__txat_translate_model || undefined }) });
                        if (tr.ok) {
                          const tj = await tr.json();
                          const translatedText = String(tj?.translated || '').trim();
                          if (translatedText) {
                            const tmsg = {
                              type: 'translation',
                              speaker,
                              text,
                              translatedText,
                              sentenceId: sid,
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
                    })();
                  }
                };
              const stop = startOpenAIRealtimeTranscriber(s, {
                transcribeModel: (window as any).__txat_transcribe_model || undefined,
                onDelta: (text) => {
                  // Drop punctuation-only deltas to avoid stray '.' or '?' lines
                  if (/^[\s.!?…]+$/.test(text)) return;
                  const cleaned = String(text).trim();
                  if (!cleaned) return;
                    // Smarter duplicate suppression:
                    // - If we already have an active interim, skip only if the delta is
                    //   1-2 words that are already present at the end of the interim.
                    // - If there is no active interim yet, suppress obvious carryover from
                    //   the previous final's trailing words (last 3 words).
                    {
                      const deltaNorm = normalizeTail(cleaned);
                      const deltaWordCount = deltaNorm ? deltaNorm.split(' ').length : 0;
                      const interimNorm = normalizeTail(currentInterimText);
                      if (currentInterimText) {
                        if (
                          deltaWordCount <= 2 &&
                          (interimNorm === deltaNorm || interimNorm.endsWith(' ' + deltaNorm))
                        ) {
                          return;
                        }
                      } else if (lastFinalText) {
                        const tail = normalizeTail(lastFinalText).split(' ').slice(-3).join(' ');
                        if (deltaNorm && (tail === deltaNorm || tail.endsWith(' ' + deltaNorm))) {
                          return;
                        }
                      }
                    }
                  if (currentSid === 0) currentSid = nextSid;
                    currentInterimText = currentInterimText ? (currentInterimText + ' ' + cleaned) : cleaned;
                    if (finalizeTimer) clearTimeout(finalizeTimer);
                    finalizeTimer = setTimeout(() => { commitFinalFromInterim(); }, 600);
                  const payload = {
                    type: 'transcription',
                    speaker: room.localParticipant.identity,
                    text: currentInterimText,
                    final: false,
                    sentenceId: currentSid,
                    timestamp: new Date().toISOString(),
                  } as const;
                    // Send interims as unreliable for low-latency fanout to other participants
                    room.localParticipant.publishData(
                      new TextEncoder().encode(JSON.stringify(payload)),
                      { reliable: false, topic: 'captions' as any }
                    ).catch(() => {});
                  try {
                    window.dispatchEvent(new CustomEvent('txat_captions_local', { detail: payload }));
                  } catch {}
                    // Immediate finalize on end punctuation
                    if (/[.!?…]$/.test(cleaned)) {
                      if (finalizeTimer) clearTimeout(finalizeTimer);
                      commitFinalFromInterim();
                    }
                },
                onCompleted: async (text) => {
                  // Guard against punctuation-only completions (merge handled by model already)
                  if (/^[\s.!?…]+$/.test(text)) return;
                  lastFinalText = String(text).trim();
                    if (finalizeTimer) clearTimeout(finalizeTimer);
                    if (currentSid === 0) currentSid = nextSid;
                    currentInterimText = lastFinalText;
                    commitFinalFromInterim();
                },
                onStatusChange: (status) => {
                  try {
                    (window as any).__txat_captions_status = status;
                    window.dispatchEvent(new CustomEvent('txat_captions_status', { detail: status }));
                  } catch {}
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
              const onPub = (pub:any, participant:any)=>{
                if(participant?.isLocal && pub?.source === Track.Source.Microphone){ toggleFork(); }
              };
              room.on(RoomEvent.TrackMuted, onMute);
              room.on(RoomEvent.TrackUnmuted, onUnmute);
              room.on(RoomEvent.LocalTrackPublished as any, onPub as any);
              toggleFork();
              // Cleanup on disconnect
              room.on(RoomEvent.Disconnected, () => {
                try { stop(); } catch {}
                room.off(RoomEvent.TrackMuted, onMute);
                room.off(RoomEvent.TrackUnmuted, onUnmute);
                room.off(RoomEvent.LocalTrackPublished as any, onPub as any);
                try { (window as any).__txat_captions_active = false; } catch {}
              });
              return; // do not run legacy MediaRecorder path
            }

            // Legacy batch STT path removed; using OpenAI Realtime streaming only
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
      if (message.startsWith('[TL]')) {
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.9 }}>
            <span style={{ fontSize: 11, lineHeight: 1, padding: '2px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.25)' }}>
              ↻
            </span>
            {message.slice(4)}
          </span>
        );
      }
      const isTranslatedChat = false;
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

  // Lightweight translated chat renderer (second line under the original)
  const translateChatFormatter = React.useCallback(
    (message: string) => {
      if (!message.startsWith('[TranslateHelper]')) return null as any;
      try {
        const payload = JSON.parse(message.replace(/^\[TranslateHelper\]/, '')) as { translated: string };
        const text = payload?.translated || '';
        if (!text) return null as any;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.95 }}>
            <span
              aria-label="Translated"
              title="Translated"
              style={{
                fontSize: 11,
                lineHeight: 1,
                padding: '2px 6px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.25)'
              }}
            >
              ↻
            </span>
            <span>{text}</span>
          </span>
        );
      } catch {}
      return null as any;
    },
    []
  );

  return (
    <div className="lk-room-container" style={{ position: 'relative' }}>
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <CaptionsChatBridge room={room} />
        <ChatTranslator room={room} />
        <HideAgentTiles />
        <VideoMirrorAll />
        <VideoConference
          chatMessageFormatter={(m) => translateChatFormatter(m) || chatFormatter(m)}
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

function ChatTranslator(props: { room: Room }) {
  const { room } = props;
  React.useEffect(() => {
    const onChat = async (msg: any) => {
      try {
        const txt: string = String(msg?.message || '');
        if (!txt || txt.startsWith('[TL]')) return; // ignore helper messages
        const from = msg?.from?.identity;
        const isSelf = !msg?.from || from === room.localParticipant.identity;
        if (!isSelf) return; // only translate our own outgoing here
        const target = (window as any).__txat_target_lang || 'en';
        if (!target) return;
        const r = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: txt, target, model: (window as any).__txat_translate_model || undefined }),
        });
        if (!r.ok) return;
        const j = await r.json();
        const translated = String(j?.translated || '').trim();
        if (!translated) return;
        const helper = `[TL] ${translated}`;
        room.localParticipant.sendChatMessage(helper).catch(() => void 0);
        // Locally insert bubble so sender sees it even if alone
        try { (room as any).emit?.('messageReceived', { from: room.localParticipant, message: helper }); } catch {}
      } catch {}
    };
    (room as any).on('messageReceived', onChat);
    return () => {
      (room as any).off('messageReceived', onChat);
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
  const [container, setContainer] = React.useState<Element | null>(null);
  const [status, setStatus] = React.useState<'live'|'reconnecting'|'paused'>('paused');
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
  // Listen for realtime transcriber status events
  React.useEffect(() => {
    const onStatus = (e: any) => {
      const s = e?.detail as any;
      if (s === 'live' || s === 'reconnecting' || s === 'paused') setStatus(s);
    };
    try { window.addEventListener('txat_captions_status' as any, onStatus as any); } catch {}
    // initialize from global if available (avoids flashing "paused")
    try {
      const cur = (window as any).__txat_captions_status;
      if (cur === 'live' || cur === 'reconnecting' || cur === 'paused') setStatus(cur);
    } catch {}
    return () => { try { window.removeEventListener('txat_captions_status' as any, onStatus as any); } catch {} };
  }, []);
  // Hide legacy Transcribing button if present
  React.useEffect(() => {
    if (!container) return;
    const hide = () => {
      const btns = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
      btns.forEach((b) => {
        const txt = (b.textContent || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (txt.includes('transcribing') || aria.includes('transcrib')) {
          (b as HTMLButtonElement).style.display = 'none';
        }
      });
    };
    hide();
    const obs = new MutationObserver(hide);
    obs.observe(container, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [container]);
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
        border: status === 'live' ? '2px solid #22c55e' : status === 'reconnecting' ? '2px solid #f5a524' : '2px solid #e5484d',
        color: status === 'live' ? '#22c55e' : status === 'reconnecting' ? '#f5a524' : '#e5484d',
        background: status === 'live' ? 'rgba(34,197,94,0.10)' : status === 'reconnecting' ? 'rgba(245,165,36,0.10)' : 'rgba(229,72,77,0.10)',
      }}
    >
      {status === 'live' ? 'Transcribing' : status === 'reconnecting' ? 'Transcribing (reconnecting…)' : 'Transcribing (paused)'}
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

function VideoMirrorAll() {
  return (
    <style>{`.lk-room-container video { transform: scaleX(-1) !important; }`}</style>
  );
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
                    const next: SpeakerState = { ...cur, blocks: blocks.sort((a,b)=>a.ts-b.ts) };
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
                  return { ...prev, [id]: { ...cur, blocks: next.sort((a,b)=>a.ts-b.ts) } };
                }
                const isTiny = slice.split(/\s+/).length < 4;
                const endsSentence = /[.!?…]$/.test(last?.text || '');
                const gapShort = last ? now - last.ts < 1200 : false;
                if (last && (gapShort || !endsSentence) && isTiny) {
                  const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                  return { ...prev, [id]: { ...cur, blocks: [...blocks.slice(0, -1), merged].sort((a,b)=>a.ts-b.ts) } };
                }
                const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
                return { ...prev, [id]: { ...cur, blocks: [...blocks, newBlock].sort((a,b)=>a.ts-b.ts) } };
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
                  return { ...prev, [id]: { ...cur, tblocks: tblocks.sort((a,b)=>a.ts-b.ts) } };
                }
                // Fallback heuristic merge (older agents)
                const blocks = cur.tblocks;
                const last = blocks[blocks.length - 1];
                const isTiny = slice.split(/\s+/).length < 4;
                const endsSentence = /[.!?…]$/.test(last?.text || '');
                const gapShort = last ? now - last.ts < 1200 : false;
                if (last && (gapShort || !endsSentence) && isTiny) {
                  const merged = { ...last, ts: now, text: (last.text + ' ' + slice).trim() };
                  return { ...prev, [id]: { ...cur, tblocks: [...blocks.slice(0, -1), merged].sort((a,b)=>a.ts-b.ts) } };
                }
                const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
                return { ...prev, [id]: { ...cur, tblocks: [...blocks, newBlock].sort((a,b)=>a.ts-b.ts) } };
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
                return { ...prev, [id]: { ...cur, blocks: [...blocks.slice(0, -1), merged].sort((a,b)=>a.ts-b.ts) } };
              }
              const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
              return { ...prev, [id]: { ...cur, blocks: [...blocks, newBlock].sort((a,b)=>a.ts-b.ts) } };
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
                return { ...prev, [id]: { ...cur, tblocks: [...blocks.slice(0, -1), merged].sort((a,b)=>a.ts-b.ts) } };
              }
              const newBlock: Block = { id: nextIdRef.current++, ts: now, text: slice };
              return { ...prev, [id]: { ...cur, tblocks: [...blocks, newBlock].sort((a,b)=>a.ts-b.ts) } };
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
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const langs = React.useMemo(() => [
    ['en','English'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['ja','Japanese'],['zh','Chinese']
  ] as [string,string][], []);
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

  // Ensure interim (italics) line stays visible as it updates
  React.useEffect(() => {
    if (transcriptRef.current) {
      const el = transcriptRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [active?.id, active?.text]);

  React.useEffect(() => {
    if (translationRef.current) {
      const el = translationRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [tblocks]);

  const isLocal = participants.some((p) => p.identity === identity && p.isLocal);
  const initialTarget = (typeof window!=='undefined'?(window as any).__txat_target_lang:'en')||'en';
  const [targetLang, setTargetLang] = React.useState(initialTarget);
  const handleTargetChange = (e: any)=>{
    const val = e.target.value;
    setTargetLang(val);
    try{ (window as any).__txat_target_lang=val; localStorage.setItem('txat_target_lang',val);}catch{}
  };
  if (!container) return null;
  return createPortal(
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 48,
        zIndex: 9999,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(0,0,0,0.55)',
        color: 'white',
        pointerEvents: 'auto',
        fontSize: 15,
        lineHeight: 1.4,
        textAlign: 'left',
        minHeight: isDesktop ? 150 : 110,
        maxHeight: isDesktop ? 334 : 250,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      {isLocal && (
        <select value={targetLang} onChange={handleTargetChange} style={{position:'absolute',top:4,right:6,fontSize:12,background:'rgba(0,0,0,0.4)',color:'white',border:'1px solid rgba(255,255,255,0.3)',borderRadius:4}} title="Translate to">
          {langs.map(([code,label])=>(<option key={code} value={code}>{code}</option>))}
        </select>
      )}
      {/* Transcript box */}
      <div
        ref={transcriptRef}
        style={{
          width: '100%',
          overflowY: 'auto',
          paddingRight: 4,
          maxHeight: isDesktop ? 126 : 84,
          borderBottom: '1px solid rgba(255,255,255,0.15)'
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

      {/* Translation box */}
      <div
        ref={translationRef}
        style={{
          width: '100%',
          overflowY: 'auto',
          paddingRight: 4,
          maxHeight: isDesktop ? 126 : 84,
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
