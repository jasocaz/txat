'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useState } from 'react';
import { encodePassphrase, generateRoomId, randomString } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

function Tabs(props: React.PropsWithChildren<{}>) {
  const searchParams = useSearchParams();
  const tabIndex = searchParams?.get('tab') === 'custom' ? 1 : 0;

  const router = useRouter();
  function onTabSelected(index: number) {
    const tab = index === 1 ? 'custom' : 'demo';
    router.push(`/?tab=${tab}`);
  }

  let tabs = React.Children.map(props.children, (child, index) => {
    return (
      <button
        className="lk-button"
        onClick={() => {
          if (onTabSelected) {
            onTabSelected(index);
          }
        }}
        aria-pressed={tabIndex === index}
      >
        {/* @ts-ignore */}
        {child?.props.label}
      </button>
    );
  });

  return (
    <div className={styles.tabContainer}>
      <div className={styles.tabSelect}>{tabs}</div>
      {/* @ts-ignore */}
      {props.children[tabIndex]}
    </div>
  );
}

function DemoMeetingTab(props: { label: string }) {
  const router = useRouter();
  const [e2ee, setE2ee] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));
  const [joinRoomId, setJoinRoomId] = useState('');
  
  const startMeeting = () => {
    const roomId = generateRoomId();
    if (e2ee) {
      router.push(`/rooms/${roomId}?captions=${captionsEnabled ? '1' : '0'}#${encodePassphrase(sharedPassphrase)}`);
    } else {
      router.push(`/rooms/${roomId}?captions=${captionsEnabled ? '1' : '0'}`);
    }
  };

  const joinMeeting = () => {
    if (!joinRoomId.trim()) return;
    const roomId = joinRoomId.trim();
    if (e2ee) {
      router.push(`/rooms/${roomId}?captions=${captionsEnabled ? '1' : '0'}#${encodePassphrase(sharedPassphrase)}`);
    } else {
      router.push(`/rooms/${roomId}?captions=${captionsEnabled ? '1' : '0'}`);
    }
  };
  return (
    <div className={styles.tabContent}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button style={{ marginTop: '1rem' }} className="lk-button" onClick={startMeeting}>
          Start Meeting
        </button>
        
        <div style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Enter meeting ID"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc' }}
            onKeyPress={(e) => e.key === 'Enter' && joinMeeting()}
          />
          <button 
            className="lk-button" 
            onClick={joinMeeting}
            disabled={!joinRoomId.trim()}
            style={{ padding: '8px 16px' }}
          >
            Join Meeting
          </button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <input
              id="captions-enabled"
              type="checkbox"
              checked={captionsEnabled}
              onChange={(ev) => setCaptionsEnabled(ev.target.checked)}
            ></input>
            <label htmlFor="captions-enabled">Transcribe & Translate</label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <input
              id="use-e2ee"
              type="checkbox"
              checked={e2ee}
              onChange={(ev) => setE2ee(ev.target.checked)}
            ></input>
            <label htmlFor="use-e2ee">Enable end-to-end encryption</label>
          </div>
          {e2ee && (
            <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
              <label htmlFor="passphrase">Passphrase</label>
              <input
                id="passphrase"
                type="password"
                value={sharedPassphrase}
                onChange={(ev) => setSharedPassphrase(ev.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomConnectionTab(props: { label: string }) {
  const router = useRouter();

  const [e2ee, setE2ee] = useState(false);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const serverUrl = formData.get('serverUrl');
    const token = formData.get('token');
    if (e2ee) {
      router.push(
        `/custom/?liveKitUrl=${serverUrl}&token=${token}#${encodePassphrase(sharedPassphrase)}`,
      );
    } else {
      router.push(`/custom/?liveKitUrl=${serverUrl}&token=${token}`);
    }
  };
  return (
    <form className={styles.tabContent} onSubmit={onSubmit}>
      <p style={{ marginTop: 0 }}>
        Connect Txat with a custom server using LiveKit Cloud or LiveKit Server.
      </p>
      <input
        id="serverUrl"
        name="serverUrl"
        type="url"
        placeholder="LiveKit Server URL: wss://*.livekit.cloud"
        required
      />
      <textarea
        id="token"
        name="token"
        placeholder="Token"
        required
        rows={5}
        style={{ padding: '1px 2px', fontSize: 'inherit', lineHeight: 'inherit' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
          <input
            id="use-e2ee"
            type="checkbox"
            checked={e2ee}
            onChange={(ev) => setE2ee(ev.target.checked)}
          ></input>
          <label htmlFor="use-e2ee">Enable end-to-end encryption</label>
        </div>
        {e2ee && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={sharedPassphrase}
              onChange={(ev) => setSharedPassphrase(ev.target.value)}
            />
          </div>
        )}
      </div>

      <hr
        style={{ width: '100%', borderColor: 'rgba(255, 255, 255, 0.15)', marginBlock: '1rem' }}
      />
      <button
        style={{ paddingInline: '1.25rem', width: '100%' }}
        className="lk-button"
        type="submit"
      >
        Connect
      </button>
    </form>
  );
}

export default function Page() {
  return (
    <>
      <main className={styles.main} data-lk-theme="default">
        <div className="header" style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <h1
            aria-label="Txat - Meet"
            style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
              fontWeight: 300,
              fontSize: '2.25rem',
              lineHeight: '2.5rem',
              letterSpacing: '-0.025em',
              color: '#ffffff',
              margin: 0,
            }}
          >
            Txat - <span style={{ color: '#ff6b5f' }}>Meet</span>
          </h1>
        </div>
        {/* Show Demo content directly without tab selector */}
        <Suspense fallback="Loading">
          <DemoMeetingTab label="Demo" />
        </Suspense>
      </main>
      {/* Footer removed */}
    </>
  );
}
