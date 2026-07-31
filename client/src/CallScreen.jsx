import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, LocalVideoTrack } from 'livekit-client';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Film, MessageSquare, PhoneOff, Sparkles, Camera, Edit3, X, CameraOff, Monitor, ShieldAlert, Check, UserPlus, Pin, PinOff } from 'lucide-react';
import MediaInjector from './MediaInjector.jsx';
import ChatPanel from './ChatPanel.jsx';
import EffectsPicker, { VIDEO_FILTERS, VIRTUAL_BACKGROUNDS } from './EffectsPicker.jsx';
import PresentationStage from './PresentationStage.jsx';
import InCallInviteModal from './InCallInviteModal.jsx';
import { captureRoomSnapshot } from './snapshotUtils.js';

function TrackTile({ item, activeFilter, activeBg, isPinned, onTogglePin }) {
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
  
  const displayLabel = item.name || (item.identity.includes('_') ? item.identity.split('_').slice(1).join('_') : item.identity);

  return (
    <div
      className={`video-tile ${isPinned ? 'pinned-tile' : ''}`}
      style={bgObj ? bgObj.style : { cursor: 'pointer' }}
      onDoubleClick={onTogglePin}
      title="Double-click to Spotlight / Pin to Max View"
    >
      <video
        ref={elRef}
        autoPlay
        playsInline
        muted={item.isLocal}
        style={{ filter: filterObj ? filterObj.css : 'none' }}
      />
      <div className="tile-overlay" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span>{displayLabel}</span>
          {item.isLocal && <span style={{ opacity: 0.7, marginLeft: '4px' }}>(you)</span>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          style={{ background: 'rgba(0,0,0,0.4)', border: 'none', color: '#fff', borderRadius: '4px', padding: '2px 4px', cursor: 'pointer' }}
          title={isPinned ? "Unpin Video" : "Spotlight Video"}
        >
          {isPinned ? <PinOff size={14} color="#f472b6" /> : <Pin size={14} />}
        </button>
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
  const [isSharingScreen, setIsSharingScreen] = useState(false);

  // Double-Click Pin / Spotlight State
  const [pinnedTrackSid, setPinnedTrackSid] = useState(null);

  // Screen Share Permission & Approval State
  const [isScreenShareApproved, setIsScreenShareApproved] = useState(false);
  const [pendingPermissionRequest, setPendingPermissionRequest] = useState(null);
  const [requestSentNotice, setRequestSentNotice] = useState(false);

  // Modals & Panels
  const [showInjector, setShowInjector] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showInCallInvite, setShowInCallInvite] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showEndMeetingConfirm, setShowEndMeetingConfirm] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  
  // Real-time Toast Banner
  const [toastNotice, setToastNotice] = useState(null);

  // Effects selection
  const [activeFilter, setActiveFilter] = useState('none');
  const [activeBg, setActiveBg] = useState('none');
  const [injectingClip, setInjectingClip] = useState(false);

  const roomRef = useRef(null);
  const socketRef = useRef(null);
  const screenTrackRef = useRef(null);

  const isOwner = roomData.owner_id === user.id;

  const addTrack = useCallback((sid, kind, identity, name, isLocal, track) => {
    setTracks((prev) => {
      if (prev.some((t) => t.sid === sid)) return prev;
      return [...prev, { sid, kind, identity, name, isLocal, track }];
    });
  }, []);

  const removeTrack = useCallback((sid) => {
    setTracks((prev) => prev.filter((t) => t.sid !== sid));
    setPinnedTrackSid((prev) => (prev === sid ? null : prev));
  }, []);

  // Socket.io connection for chat, snapshots, end-meeting, and display name sync
  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const socket = io(serverUrl, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId: roomData.id });
    });

    socket.on('meeting-ended', ({ endedBy }) => {
      alert(`The meeting was ended for everyone by ${endedBy}.`);
      onLeave();
    });

    socket.on('participant-renamed', ({ userId, newDisplayName }) => {
      setTracks((prev) =>
        prev.map((t) => (t.identity.startsWith(userId) ? { ...t, name: newDisplayName } : t))
      );
    });

    socket.on('snapshot-notification', (data) => {
      setToastNotice(`📸 Room Memory Snapshot captured by ${data.takenBy}!`);
      setTimeout(() => setToastNotice(null), 4500);
    });

    socket.on('presentation-media-changed', (mediaData) => {
      setSharedMedia(mediaData);
      if (!mediaData) setIsSharingScreen(false);
    });

    socket.on('screen-share-request-received', (data) => {
      if (isOwner && data.requesterUserId !== user.id) {
        setPendingPermissionRequest(data);
      }
    });

    socket.on('screen-share-permission-result', ({ allowed }) => {
      setRequestSentNotice(false);
      if (allowed) {
        setIsScreenShareApproved(true);
        startNativeScreenShare();
      } else {
        alert('The room creator denied your screen share request.');
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [token, roomData.id, isOwner, user.id, onLeave]);

  // LiveKit connection with URL scheme fallback
  useEffect(() => {
    let rawUrl = (import.meta.env.VITE_LIVEKIT_URL || 'wss://omnicall-gfhd6nn2.livekit.cloud').trim();
    if (!rawUrl || rawUrl.includes('xxxx') || !rawUrl.includes('omnicall-gfhd6nn2')) {
      rawUrl = 'wss://omnicall-gfhd6nn2.livekit.cloud';
    }
    if (!rawUrl.startsWith('wss://') && !rawUrl.startsWith('ws://')) {
      rawUrl = `wss://${rawUrl.replace(/^https?:\/\//, '')}`;
    }
    const livekitUrl = rawUrl;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      addTrack(publication.trackSid, track.kind, participant.identity, participant.name, false, track);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
      removeTrack(publication.trackSid);
    });

    room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      if (publication.track) {
        addTrack(publication.trackSid, publication.track.kind, participant.identity, participant.name || displayName, true, publication.track);
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
  }, [roomToken, addTrack, removeTrack, onLeave, displayName]);

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
      prev.map((t) => (t.isLocal ? { ...t, name: updated } : t))
    );

    if (socketRef.current) {
      socketRef.current.emit('user-renamed', {
        roomId: roomData.id,
        newDisplayName: updated,
      });
    }

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
    if (isSharingScreen && screenTrackRef.current) {
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
      setIsSharingScreen(false);
    }

    setSharedMedia(null);

    if (socketRef.current) {
      socketRef.current.emit('stop-presentation-media', {
        roomId: roomData.id,
      });
    }
  };

  const handleScreenShareClick = () => {
    if (isSharingScreen) {
      handleStopPresentation();
      return;
    }

    if (isOwner || isScreenShareApproved) {
      startNativeScreenShare();
    } else {
      if (socketRef.current) {
        socketRef.current.emit('request-screen-share-permission', {
          roomId: roomData.id,
          requesterName: displayName,
        });
        setRequestSentNotice(true);
      }
    }
  };

  const startNativeScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const videoTrack = stream.getVideoTracks()[0];
      screenTrackRef.current = videoTrack;

      videoTrack.onended = () => {
        handleStopPresentation();
      };

      if (roomRef.current && videoTrack) {
        const lkTrack = new LocalVideoTrack(videoTrack);
        await roomRef.current.localParticipant.publishTrack(lkTrack);
      }

      setIsSharingScreen(true);

      if (socketRef.current) {
        socketRef.current.emit('share-presentation-media', {
          roomId: roomData.id,
          mediaUrl: '',
          mediaName: 'Screen & Tab Watch Party',
          mediaType: 'video/screenshare',
          presenterName: displayName,
        });
      }
    } catch (err) {
      console.warn('Screen share canceled or failed:', err);
      setRequestSentNotice(false);
    }
  };

  const handleRespondPermission = (allowed) => {
    if (pendingPermissionRequest && socketRef.current) {
      socketRef.current.emit('respond-screen-share-permission', {
        requesterSocketId: pendingPermissionRequest.requesterSocketId,
        allowed,
      });
      setPendingPermissionRequest(null);
    }
  };

  const handleEndMeetingForAll = () => {
    if (socketRef.current) {
      socketRef.current.emit('end-meeting-for-all', { roomId: roomData.id });
    }
    onLeave();
  };

  const videoTracks = tracks.filter((t) => t.kind === Track.Kind.Video);
  const audioTracks = tracks.filter((t) => t.kind === Track.Kind.Audio);
  const isPresenter = sharedMedia && sharedMedia.presenterName === displayName;

  const pinnedTrack = videoTracks.find((t) => t.sid === pinnedTrackSid);
  const unpinnedVideoTracks = pinnedTrack ? videoTracks.filter((t) => t.sid !== pinnedTrackSid) : videoTracks;

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
            onClick={() => { setNewNickname(displayName); setShowRenameModal(true); }}
          >
            <Edit3 size={12} /> Rename
          </button>
        </div>
      </header>

      <div className="call-body">
        {toastNotice && (
          <div className="snapshot-toast-banner">
            {toastNotice}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Shared Presentation Stage */}
          <PresentationStage
            media={sharedMedia}
            isPresenter={isPresenter}
            onStopPresentation={handleStopPresentation}
          />

          {/* Double-Clicked Spotlight / Pinned Hero Video Stage */}
          {pinnedTrack && (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
              <div style={{ width: '100%', height: '100%', maxHeight: '60vh', borderRadius: '12px', overflow: 'hidden', border: '2px solid #ec4899', boxShadow: '0 8px 32px rgba(236,72,153,0.3)' }}>
                <TrackTile
                  item={pinnedTrack}
                  activeFilter={activeFilter}
                  activeBg={activeBg}
                  isPinned={true}
                  onTogglePin={() => setPinnedTrackSid(null)}
                />
              </div>
            </div>
          )}

          {/* Participant Video Grid */}
          <div className="video-grid" style={sharedMedia || pinnedTrack ? { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', maxHeight: '180px' } : {}}>
            {unpinnedVideoTracks.map((item) => (
              <TrackTile
                key={item.sid}
                item={item}
                activeFilter={activeFilter}
                activeBg={activeBg}
                isPinned={false}
                onTogglePin={() => setPinnedTrackSid(item.sid)}
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

        {showInCallInvite && (
          <InCallInviteModal
            token={token}
            roomId={roomData.id}
            roomName={roomData.name}
            onClose={() => setShowInCallInvite(false)}
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
          className="control-btn"
          onClick={() => setShowInCallInvite(true)}
          title="Invite People by Username / Email"
          style={{ background: 'rgba(99, 102, 241, 0.25)', borderColor: '#818cf8' }}
        >
          <UserPlus size={20} color="#818cf8" />
        </button>

        <button
          className={`control-btn ${isSharingScreen ? 'active' : ''}`}
          onClick={handleScreenShareClick}
          title={isOwner ? "Share Screen / Watch Party" : "Request Screen Share Permission from Room Creator"}
          style={isSharingScreen ? { background: '#ec4899', color: '#fff' } : {}}
        >
          <Monitor size={20} />
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

        <button
          className="control-btn danger"
          onClick={() => {
            if (isOwner) {
              setShowEndMeetingConfirm(true);
            } else {
              onLeave();
            }
          }}
          title="Leave or End Call"
        >
          <PhoneOff size={20} />
        </button>
      </footer>

      {requestSentNotice && (
        <div className="snapshot-toast-banner" style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
          ⌛ Permission request sent to room creator... Please wait for approval.
        </div>
      )}

      {/* Owner Permission Request Popover Modal */}
      {pendingPermissionRequest && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box" style={{ width: '380px', border: '1px solid rgba(236, 72, 153, 0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.125rem', marginBottom: '12px' }}>
              <ShieldAlert size={22} color="#ec4899" /> Screen Share Permission Request
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Participant <strong>{pendingPermissionRequest.requesterName}</strong> wants to share their screen / browser tab in this call.
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-outline"
                onClick={() => handleRespondPermission(false)}
                style={{ flex: 1, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
              >
                Deny
              </button>

              <button
                className="btn-primary"
                onClick={() => handleRespondPermission(true)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <Check size={16} /> Allow Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Owner End Meeting for All Confirmation Modal */}
      {showEndMeetingConfirm && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box" style={{ width: '360px' }}>
            <span style={{ fontWeight: 600, fontSize: '1.125rem', display: 'block', marginBottom: '12px' }}>Meeting Control</span>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              You are the room creator. Would you like to leave the meeting or end it for all participants?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                className="btn-primary"
                onClick={handleEndMeetingForAll}
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
              >
                End Meeting for All
              </button>
              <button
                className="btn-outline"
                onClick={onLeave}
              >
                Just Leave Meeting
              </button>
              <button
                className="btn-outline"
                onClick={() => setShowEndMeetingConfirm(false)}
                style={{ border: 'none', color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
