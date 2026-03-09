import React from 'react';
import {
  MediaDeviceMenu,
  TrackReference,
  TrackToggle,
  useLocalParticipant,
  VideoTrack,
} from '@livekit/components-react';
import { BackgroundBlur, VirtualBackground } from '@livekit/track-processors';
import { isLocalTrack, LocalTrackPublication, Track } from 'livekit-client';
// Background image paths - using public folder paths directly
const BACKGROUND_IMAGES = [
  { name: 'Desk', path: '/background-images/samantha-gades-BlIhVfXbi9s-unsplash.jpg' },
  { name: 'Nature', path: '/background-images/ali-kazal-tbw_KQE3Cbg-unsplash.jpg' },
];

// Background options
type BackgroundType = 'none' | 'blur' | 'image';

export function CameraSettings() {
  const { cameraTrack, localParticipant } = useLocalParticipant();

  const [mirrorVideo, setMirrorVideo] = React.useState(() => {
    try {
      const stored = localStorage.getItem('txat_mirror_video');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleMirror = () => {
    const next = !mirrorVideo;
    setMirrorVideo(next);
    try { localStorage.setItem('txat_mirror_video', String(next)); } catch {}
    window.dispatchEvent(new CustomEvent('txat_mirror_video', { detail: next }));
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/4f6c001c-c80e-4127-b26c-2172368c1a16',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8401b4'},body:JSON.stringify({sessionId:'8401b4',location:'CameraSettings.tsx:toggleMirror',message:'toggleMirror called',data:{prev:mirrorVideo,next,lsValue:localStorage.getItem('txat_mirror_video')},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  };

  const [backgroundType, setBackgroundType] = React.useState<BackgroundType>(
    (cameraTrack as LocalTrackPublication)?.track?.getProcessor()?.name === 'background-blur'
      ? 'blur'
      : (cameraTrack as LocalTrackPublication)?.track?.getProcessor()?.name === 'virtual-background'
        ? 'image'
        : 'none',
  );

  const [virtualBackgroundImagePath, setVirtualBackgroundImagePath] = React.useState<string | null>(
    null,
  );

  const camTrackRef: TrackReference | undefined = React.useMemo(() => {
    return cameraTrack
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : undefined;
  }, [localParticipant, cameraTrack]);

  const selectBackground = (type: BackgroundType, imagePath?: string) => {
    setBackgroundType(type);
    if (type === 'image' && imagePath) {
      setVirtualBackgroundImagePath(imagePath);
    } else if (type !== 'image') {
      setVirtualBackgroundImagePath(null);
    }
  };

  React.useEffect(() => {
    if (isLocalTrack(cameraTrack?.track)) {
      if (backgroundType === 'blur') {
        cameraTrack.track?.setProcessor(BackgroundBlur());
      } else if (backgroundType === 'image' && virtualBackgroundImagePath) {
        cameraTrack.track?.setProcessor(VirtualBackground(virtualBackgroundImagePath));
      } else {
        cameraTrack.track?.stopProcessor();
      }
    }
  }, [cameraTrack, backgroundType, virtualBackgroundImagePath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {camTrackRef && (
        <VideoTrack
          style={{
            maxHeight: '280px',
            objectFit: 'contain',
            objectPosition: 'right',
            transform: mirrorVideo ? 'scaleX(-1)' : 'none',
          }}
          trackRef={camTrackRef}
        />
      )}

      <section className="lk-button-group">
        <TrackToggle source={Track.Source.Camera}>Camera</TrackToggle>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="videoinput" />
        </div>
      </section>

      <section style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
        <label
          htmlFor="mirror-video-toggle"
          style={{ cursor: 'pointer', userSelect: 'none', fontSize: 14 }}
        >
          Mirror video
        </label>
        <button
          id="mirror-video-toggle"
          role="switch"
          aria-checked={mirrorVideo}
          onClick={toggleMirror}
          style={{
            width: 42,
            height: 24,
            borderRadius: 12,
            border: 'none',
            cursor: 'pointer',
            position: 'relative',
            background: mirrorVideo ? '#0090ff' : '#555',
            transition: 'background 0.2s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: mirrorVideo ? 21 : 3,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left 0.2s',
            }}
          />
        </button>
      </section>

      <div style={{ marginTop: '10px' }}>
        <div style={{ marginBottom: '8px' }}>Background Effects</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => selectBackground('none')}
            className="lk-button"
            aria-pressed={backgroundType === 'none'}
            style={{
              border: backgroundType === 'none' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
            }}
          >
            None
          </button>

          <button
            onClick={() => selectBackground('blur')}
            className="lk-button"
            aria-pressed={backgroundType === 'blur'}
            style={{
              border: backgroundType === 'blur' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
              backgroundColor: '#f0f0f0',
              position: 'relative',
              overflow: 'hidden',
              height: '60px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#e0e0e0',
                filter: 'blur(8px)',
                zIndex: 0,
              }}
            />
            <span
              style={{
                position: 'relative',
                zIndex: 1,
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '2px 5px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              Blur
            </span>
          </button>

          {BACKGROUND_IMAGES.map((image) => (
            <button
              key={image.path}
              onClick={() => selectBackground('image', image.path)}
              className="lk-button"
              aria-pressed={
                backgroundType === 'image' && virtualBackgroundImagePath === image.path
              }
              style={{
                backgroundImage: `url(${image.path})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                width: '80px',
                height: '60px',
                border:
                  backgroundType === 'image' && virtualBackgroundImagePath === image.path
                    ? '2px solid #0090ff'
                    : '1px solid #d1d1d1',
              }}
            >
              <span
                style={{
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                {image.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
