import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Film, MessageSquare, PhoneOff, Sparkles, Camera, Edit3, X, CameraOff } from 'lucide-react';
import MediaInjector from './MediaInjector.jsx';
import ChatPanel from './ChatPanel.jsx';
import EffectsPicker, { VIDEO_FILTERS, VIRTUAL_BACKGROUNDS } from './EffectsPicker.jsx';
import PresentationStage from './PresentationStage.jsx';
import { captureRoomSnapshot } from './snapshotUtils.js';

function TrackTile({ item, activeFilter, activeBg }) {
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!item.track || !el) return;
    item.track.attach(el);
    return () => {
      item.track.detach(el);
    };
  }, [item.track]);

  if (item.kind === Track.Kind.Audio) {
    return <audio ref={elRef} autoPlay />;
  }

  const filterObj = item.isLocal ? VIDEO_FILTERS.find((f) => f.id === activeFilter) : null;
  const bgObj = item.isLocal ? VIRTUAL_BACKGROUNDS.find((b) => b.id === activeBg) : null;

  return (
    <div className="video-tile" style={bgObj ? bgObj.style : {}}>
      <video
        ref={elRef}
        autoPlay
        playsInline
        muted={item.isLocal}
        style={{ filter: filterObj ? filterObj.css : 'none' }}
      />
      <div className="tile-overlay">
        <span>{item.identity}</span>
        {item.isLocal && <span style={{ opacity: 0.7 }}>(you)</span>}
      </div>
    </div>
  );
}

export default function CallScreen({ token, user, roomData, roomToken, initialDisplayName, onLeave }) {
  const [tracks, setTracks] = useState([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [displayName, setDisplayName] = useState(initialDisplayName || user.name);

  // Shared Presentation Stage state
  const [sharedMedia, setSharedMedia] = useState(null);

  // Modals & Panels
  const [showInjector, setShowInjector] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  
  // Real-time Snapshot Notification Toast
  const [snapshotToast, setSnapshotToast] = useState(null);

  // Effects selection
  const [activeFilter, setActiveFilter] = useState('none');
  const [activeBg, setActiveBg] = useState('none');
  const [injectingClip, setInjectingClip] = useState(false);

  const roomRef = useRef(null);
  const socketRef = useRef(null);

  const isOwner = roomData.owner_id === user.id;

  const addTrack = useCallback((sid, kind, identity, isLocal, track) => {
    setTracks((prev) => {
      if (prev.some((t) => t.sid === sid)) return prev;
      return [...prev, { sid, kind, identity, isLocal, track }];
    });
  }, []);

  const removeTrack = useCallback((sid) => {
    setTracks((prev) => prev.filter((t) => t.sid !== sid));
  }, []);

  // Socket.io connection for snapshot & presentation broadcasts
  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const socket = io(serverUrl, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId: roomData.id });
    });

    socket.on('snapshot-notification', (data) => {
      setSnapshotToast(`📸 Room Memory Snapshot captured by ${data.takenBy}!`);
      setTimeout(() => setSnapshotToast(null), 4500);
    });

    socket.on('presentation-media-changed', (mediaData) => {
      setSharedMedia(mediaData);
    });

    return () => {
      socket.disconnect();
    };
  }, [token, roomData.id]);

  // LiveKit connection
  useEffect(() => {
    const livekitUrl = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      addTrack(publication.trackSid, track.kind, participant.identity, false, track);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
      removeTrack(publication.trackSid);
    });

    room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      if (publication.track) {
        addTrack(publication.trackSid, publication.track.kind, participant.identity, true, publication.track);
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      removeTrack(publication.trackSid);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      setTracks((prev) => prev.filter((t) => t.identity !== participant.identity));
    });

    async function connect() {
      try {
        await room.connect(livekitUrl, roomToken);
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error('Failed to connect to LiveKit room:', err);
        alert(`Failed to join call: ${err.message}`);
        onLeave();
      }
    }

    connect();

    return () => {
      room.disconnect();
    };
  }, [roomToken, addTrack, removeTrack, onLeave]);

  const toggleMic = async () => {
    if (!roomRef.current) return;
    const newState = !micOn;
    await roomRef.current.localParticipant.setMicrophoneEnabled(newState);
    setMicOn(newState);
  };

  const toggleCam = async () => {
    if (!roomRef.current) return;
    const newState = !camOn;
    await roomRef.current.localParticipant.setCameraEnabled(newState);
    setCamOn(newState);
  };

  const handleUpdateInRoomName = (e) => {
    e.preventDefault();
    if (!newNickname.trim()) return;
    const updated = newNickname.trim().slice(0, 50);
    setDisplayName(updated);
    
    setTracks((prev) =>
      prev.map((t) => (t.isLocal ? { ...t, identity: updated } : t))
    );
    setShowRenameModal(false);
  };

  const handleTakeSnapshot = () => {
    if (!isOwner) {
      alert('Only the room creator/owner can capture memory snapshots.');
      return;
    }

    captureRoomSnapshot(roomData.name);

    if (socketRef.current) {
      socketRef.current.emit('snapshot-taken', {
        roomId: roomData.id,
        displayName,
      });
    }
  };

  const handleSharePresentation = (mediaUrl, mediaName, mediaType) => {
    if (socketRef.current) {
      socketRef.current.emit('share-presentation-media', {
        roomId: roomData.id,
        mediaUrl,
        mediaName,
        mediaType,
        presenterName: displayName,
      });
    }
    setShowInjector(false);
  };

  const handleStopPresentation = () => {
    if (socketRef.current) {
      socketRef.current.emit('stop-presentation-media', {
        roomId: roomData.id,
      });
    }
  };

  const videoTracks = tracks.filter((t) => t.kind === Track.Kind.Video);
  const audioTracks = tracks.filter((t) => t.kind === Track.Kind.Audio);
  const isPresenter = sharedMedia && sharedMedia.presenterName === displayName;

  return (
    <div className="call-layout">
      <header className="call-header">
        <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>Room: {roomData.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Speaking as: <strong style={{ color: '#818cf8' }}>{displayName}</strong>
          </span>
          <button
            className="btn-outline"
            style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => { setNewNickname(displayName); setShowRenameModal(false); }}
          >
            <Edit3 size={12} /> Rename
          </button>
        </div>
      </header>

      <div className="call-body">
        {/* Real-time Snapshot Toast Banner */}
        {snapshotToast && (
          <div className="snapshot-toast-banner">
            {snapshotToast}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Shared Presentation Stage */}
          <PresentationStage
            media={sharedMedia}
            isPresenter={isPresenter}
            onStopPresentation={handleStopPresentation}
          />

          {/* Participant Video Grid */}
          <div className="video-grid">
            {videoTracks.map((item) => (
              <TrackTile
                key={item.sid}
                item={item}
                activeFilter={activeFilter}
                activeBg={activeBg}
              />
            ))}
          </div>
        </div>

        {audioTracks.map((item) => (
          <TrackTile key={item.sid} item={item} />
        ))}

        {showEffects && (
          <EffectsPicker
            activeFilter={activeFilter}
            activeBg={activeBg}
            onSelectFilter={(f) => setActiveFilter(f)}
            onSelectBg={(b) => setActiveBg(b)}
            onClose={() => setShowEffects(false)}
          />
        )}

        {showInjector && (
          <MediaInjector
            token={token}
            room={roomRef.current}
            onClose={() => setShowInjector(false)}
            onActiveStateChange={(active) => setInjectingClip(active)}
            onSharePresentation={handleSharePresentation}
          />
        )}

        {showChat && (
          <ChatPanel
            token={token}
            roomId={roomData.id}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>

      <footer className="call-controls">
        <button className={`control-btn ${!micOn ? 'danger' : ''}`} onClick={toggleMic} title="Toggle Mic">
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        <button className={`control-btn ${!camOn ? 'danger' : ''}`} onClick={toggleCam} title="Toggle Camera">
          {camOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
        </button>

        <button
          className={`control-btn ${showEffects ? 'active' : ''}`}
          onClick={() => setShowEffects((prev) => !prev)}
          title="Video Filters & Virtual Backgrounds"
        >
          <Sparkles size={20} />
        </button>

        <button
          className={`control-btn ${injectingClip ? 'active' : ''}`}
          onClick={() => setShowInjector((prev) => !prev)}
          title="Inject Media (Images, Video, Audio)"
        >
          <Film size={20} />
        </button>

        {isOwner ? (
          <button
            className="control-btn"
            onClick={handleTakeSnapshot}
            title="Take Room Memory Screenshot PNG (Owner Only)"
            style={{ background: 'rgba(236, 72, 153, 0.25)', borderColor: '#f472b6' }}
          >
            <Camera size={20} color="#f472b6" />
          </button>
        ) : (
          <button
            className="control-btn"
            disabled
            style={{ opacity: 0.4, cursor: 'not-allowed' }}
            title="Only the room creator can take memory snapshots"
          >
            <CameraOff size={20} />
          </button>
        )}

        <button
          className={`control-btn ${showChat ? 'active' : ''}`}
          onClick={() => setShowChat((prev) => !prev)}
          title="Toggle In-Call Chat"
        >
          <MessageSquare size={20} />
        </button>

        <button className="control-btn danger" onClick={onLeave} title="Leave Call">
          <PhoneOff size={20} />
        </button>
      </footer>

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box" style={{ width: '320px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 600 }}>Change In-Room Nickname</span>
              <button onClick={() => setShowRenameModal(false)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleUpdateInRoomName}>
              <input
                className="form-control"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                maxLength={50}
                required
              />
              <button type="submit" className="btn-primary" style={{ marginTop: '12px' }}>
                Update Display Name
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
