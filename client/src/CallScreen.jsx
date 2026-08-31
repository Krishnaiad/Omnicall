import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, LocalVideoTrack } from 'livekit-client';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Film, MessageSquare, PhoneOff, Sparkles, Camera, Edit3, X, CameraOff, Monitor, ShieldAlert, Check, UserPlus, Pin, PinOff, Tv, Zap, ZapOff, Volume2, BarChart3, Hand, Edit2, MessageSquareQuote } from 'lucide-react';
import MediaInjector from './MediaInjector.jsx';
import ChatPanel from './ChatPanel.jsx';
import EffectsPicker, { VIDEO_FILTERS, VIRTUAL_BACKGROUNDS } from './EffectsPicker.jsx';
import PresentationStage from './PresentationStage.jsx';
import InCallInviteModal from './InCallInviteModal.jsx';
import WhiteboardModal from './WhiteboardModal.jsx';
import PollsPanel from './PollsPanel.jsx';
import HandRaiseQueue from './HandRaiseQueue.jsx';
import LiveCaptionsOverlay from './LiveCaptionsOverlay.jsx';
import { captureRoomSnapshot } from './snapshotUtils.js';


function TrackTile({ item, activeFilter, activeBg, isPinned, onTogglePin, isSpeaking, isDataSaver }) {
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

  // If Data Saver is active, bypass heavy CSS filters to save mobile CPU & battery
  const filterObj = (!isDataSaver && item.isLocal) ? VIDEO_FILTERS.find((f) => f.id === activeFilter) : null;
  const bgObj = (!isDataSaver && item.isLocal) ? VIRTUAL_BACKGROUNDS.find((b) => b.id === activeBg) : null;
  
  const displayLabel = item.name || (item.identity.includes('_') ? item.identity.split('_').slice(1).join('_') : item.identity);

  const filterCss = filterObj && filterObj.css !== 'none' ? filterObj.css : '';
  let videoFilterStr = filterCss || 'none';
  let videoStyle = { width: '100%', height: '100%', objectFit: 'cover', transition: 'all 0.3s ease' };
  let containerStyle = { position: 'relative', cursor: 'pointer', overflow: 'hidden' };

  if (bgObj && bgObj.id !== 'none') {
    if (bgObj.id.startsWith('blur-')) {
      const blurAmount = bgObj.id === 'blur-deep' ? '25px' : '10px';
      videoFilterStr = filterCss ? `${filterCss} blur(${blurAmount})` : `blur(${blurAmount})`;
    } else if (bgObj.imgUrl) {
      containerStyle = {
        ...containerStyle,
        backgroundImage: `url(${bgObj.imgUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        padding: '12px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      };
      videoStyle = {
        ...videoStyle,
        borderRadius: '16px',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.75)',
        width: '92%',
        height: '92%',
      };
    }
  }

  videoStyle.filter = videoFilterStr;

  return (
    <div
      className={`video-tile ${isPinned ? 'pinned-tile' : ''} ${isSpeaking ? 'speaking-active' : ''}`}
      style={containerStyle}
      onDoubleClick={onTogglePin}
      title="Double-click to Spotlight / Pin to Max View"
    >
      <video
        ref={elRef}
        autoPlay
        playsInline
        muted={item.isLocal}
        style={videoStyle}
      />
      <div className="tile-overlay" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 600 }}>{displayLabel}</span>
          {item.isLocal && <span style={{ opacity: 0.7 }}>(you)</span>}
          {isSpeaking && (
            <span className="speaking-badge" title="Actively speaking">
              <Volume2 size={11} /> Speaking
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          style={{ background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
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

  // Active Speakers State (Point 7 Feature)
  const [speakingIdentities, setSpeakingIdentities] = useState(new Set());

  // Data-Saver Low-Bandwidth Mode
  const [dataSaverMode, setDataSaverMode] = useState(false);


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

  // ─── Room State Service UI States ──────────────────────────────────────────
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [showPolls, setShowPolls] = useState(false);
  const [showHandRaise, setShowHandRaise] = useState(false);
  const [handRaiseCount, setHandRaiseCount] = useState(0);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  // ───────────────────────────────────────────────────────────────────────────

  
  // Real-time Toast Banner
  const [toastNotice, setToastNotice] = useState(null);

  // Effects selection
  const [activeFilter, setActiveFilter] = useState('none');
  const [activeBg, setActiveBg] = useState('none');
  const [injectingClip, setInjectingClip] = useState(false);

  const roomRef = useRef(null);
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

  // Helper to publish Data Packet via LiveKit WebRTC DataChannel
  const sendDataPacket = useCallback((payload, topic = 'default', destinationIdentities = undefined) => {
    if (!roomRef.current || !roomRef.current.localParticipant) return;
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(payload));
      roomRef.current.localParticipant.publishData(data, {
        topic,
        destinationIdentities,
      });
    } catch (err) {
      console.warn('Failed to send LiveKit DataPacket:', err.message);
    }
  }, []);

  // LiveKit connection and WebRTC DataPacket event handlers
  useEffect(() => {
    let rawUrl = (import.meta.env.VITE_LIVEKIT_URL || 'wss://omnicall-gfhd6nn2.livekit.cloud').trim();
    if (!rawUrl) {
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

    // Handle incoming LiveKit DataPackets
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));

        if (topic === 'meeting-control') {
          if (data.type === 'MEETING_ENDED') {
            setToastNotice(`⚠️ The meeting was ended for everyone by ${data.endedBy}.`);
            setTimeout(() => onLeave(), 2500);
          } else if (data.type === 'SNAPSHOT_TAKEN') {
            setToastNotice(`📸 Room Memory Snapshot captured by ${data.takenBy}!`);
            setTimeout(() => setToastNotice(null), 4500);
          } else if (data.type === 'PARTICIPANT_RENAMED') {
            setTracks((prev) =>
              prev.map((t) => (t.identity === data.userId || t.identity.startsWith(data.userId) ? { ...t, name: data.newDisplayName } : t))
            );
          } else if (data.type === 'PRESENTATION_MEDIA') {
            setSharedMedia(data.media);
            if (!data.media) setIsSharingScreen(false);
          }
        } else if (topic === 'screen-share-perm') {
          if (data.type === 'REQUEST' && isOwner && participant.identity !== user.id) {
            setPendingPermissionRequest({
              requesterUserId: participant.identity,
              requesterName: data.requesterName,
            });
          } else if (data.type === 'RESPONSE') {
            setRequestSentNotice(false);
            if (data.allowed) {
              setIsScreenShareApproved(true);
              setTimeout(() => startNativeScreenShare(), 0);
            } else {
              setToastNotice('❌ The room creator denied your screen share request.');
              setTimeout(() => setToastNotice(null), 4000);
            }
          }
        }
      } catch (err) {
        console.warn('DataReceived parse notice:', err.message);
      }
    });

    // ── Point 3 Fix: Read metadata from EXISTING participants on join ──────────
    // When you join a room that already has a presentation in progress,
    // the presenter's setMetadata() call persists on the SFU — recover state from it.
    function applyParticipantMetadata(participant) {
      try {
        if (!participant.metadata) return;
        const meta = JSON.parse(participant.metadata);
        if (meta.presenting) {
          setSharedMedia(meta.presenting);
        }
        // Sync display names from LiveKit's authoritative name field
        if (participant.name) {
          setTracks((prev) =>
            prev.map((t) =>
              t.identity === participant.identity ? { ...t, name: participant.name } : t
            )
          );
        }
      } catch {}
    }

    // For participants who are already in the room when we join
    room.on(RoomEvent.Connected, () => {
      room.remoteParticipants.forEach(applyParticipantMetadata);
    });

    // For participants who join AFTER us
    room.on(RoomEvent.ParticipantConnected, applyParticipantMetadata);

    // When any participant updates their metadata (live nickname rename, presentation start/stop)
    room.on(RoomEvent.ParticipantMetadataChanged, (_prevMeta, participant) => {
      applyParticipantMetadata(participant);
    });

    // When participant's name is updated via setName() — sync tiles
    room.on(RoomEvent.ParticipantNameChanged, (name, participant) => {
      setTracks((prev) =>
        prev.map((t) => (t.identity === participant.identity ? { ...t, name } : t))
      );
    });

    // ── Active Speaker Detection (Feature 7: Glow Ring) ────────────────────────
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      setSpeakingIdentities(new Set(speakers.map((s) => s.identity)));
    });
    // ─────────────────────────────────────────────────────────────────────────


    async function connect() {
      try {
        await room.connect(livekitUrl, roomToken);
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error('Failed to connect to LiveKit room:', err);
        setToastNotice(`❌ Failed to join call: ${err.message}`);
        setTimeout(() => onLeave(), 3000);
      }
    }

    connect();

    return () => {
      room.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Live in-room nickname switch with instant broadcast and local sync
  const handleUpdateInRoomName = async (e) => {
    e.preventDefault();
    if (!newNickname.trim()) return;
    const updated = newNickname.trim().slice(0, 50);
    setDisplayName(updated);
    
    // 1. Update all local video/audio tracks in state immediately
    setTracks((prev) =>
      prev.map((t) => (t.isLocal ? { ...t, name: updated } : t))
    );

    // 2. Broadcast via LiveKit DataPacket to all room peers
    sendDataPacket({ type: 'PARTICIPANT_RENAMED', userId: user.id, newDisplayName: updated }, 'meeting-control');

    // 3. Update LiveKit local participant name natively
    if (roomRef.current?.localParticipant?.setName) {
      try {
        await roomRef.current.localParticipant.setName(updated);
      } catch (err) {
        console.warn('LiveKit local participant name update notice:', err.message);
      }
    }

    setToastNotice(`✨ Your speaking name updated to: ${updated}`);
    setTimeout(() => setToastNotice(null), 3000);
    setShowRenameModal(false);
  };

  const handleTakeSnapshot = () => {
    if (!isOwner) {
      setToastNotice('⚠️ Only the room creator/owner can capture memory snapshots.');
      setTimeout(() => setToastNotice(null), 3000);
      return;
    }

    captureRoomSnapshot(roomData.name);
    sendDataPacket({ type: 'SNAPSHOT_TAKEN', takenBy: displayName }, 'meeting-control');
  };

  const handleSharePresentation = (mediaUrl, mediaName, mediaType) => {
    const mediaObj = { mediaUrl, mediaName, mediaType, presenterName: displayName };
    setSharedMedia(mediaObj);
    sendDataPacket({ type: 'PRESENTATION_MEDIA', media: mediaObj }, 'meeting-control');

    // ── Point 3 Fix: Store presentation in SFU metadata so late joiners recover state ──
    if (roomRef.current?.localParticipant?.setMetadata) {
      roomRef.current.localParticipant.setMetadata(JSON.stringify({ presenting: mediaObj })).catch(() => {});
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
    sendDataPacket({ type: 'PRESENTATION_MEDIA', media: null }, 'meeting-control');

    // Clear presentation from SFU metadata
    if (roomRef.current?.localParticipant?.setMetadata) {
      roomRef.current.localParticipant.setMetadata(JSON.stringify({ presenting: null })).catch(() => {});
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
      sendDataPacket({ type: 'REQUEST', requesterName: displayName }, 'screen-share-perm', [roomData.owner_id]);
      setRequestSentNotice(true);
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
      const mediaObj = { mediaUrl: '', mediaName: 'Screen & Tab Watch Party', mediaType: 'video/screenshare', presenterName: displayName };
      setSharedMedia(mediaObj);
      sendDataPacket({ type: 'PRESENTATION_MEDIA', media: mediaObj }, 'meeting-control');

      // Store screen share in SFU metadata so late joiners see the presentation stage
      if (roomRef.current?.localParticipant?.setMetadata) {
        roomRef.current.localParticipant.setMetadata(JSON.stringify({ presenting: mediaObj })).catch(() => {});
      }
    } catch (err) {
      console.warn('Screen share canceled or failed:', err);
      setRequestSentNotice(false);
    }
  };


  const handleRespondPermission = (allowed) => {
    if (pendingPermissionRequest) {
      sendDataPacket({ type: 'RESPONSE', allowed }, 'screen-share-perm', [pendingPermissionRequest.requesterUserId]);
      setPendingPermissionRequest(null);
    }
  };

  const handleEndMeetingForAll = () => {
    sendDataPacket({ type: 'MEETING_ENDED', endedBy: displayName }, 'meeting-control');
    onLeave();
  };

  // Picture-in-Picture (PiP) Mode Handler
  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      // Target spotlighted pinned video, or active speaker, or first visible video tile
      const videoEl =
        document.querySelector('.pinned-tile video') ||
        document.querySelector('.video-tile.speaking-active video') ||
        document.querySelector('.video-tile video');

      if (videoEl) {
        if (videoEl.requestPictureInPicture) {
          await videoEl.requestPictureInPicture();
        } else if (videoEl.webkitSetPresentationMode) {
          videoEl.webkitSetPresentationMode('picture-in-picture');
        }
      } else {
        setToastNotice('⚠️ No active video available for Picture-in-Picture mode.');
        setTimeout(() => setToastNotice(null), 3000);
      }
    } catch (err) {
      console.warn('PiP notice:', err.message);
      setToastNotice(`PiP notice: ${err.message}`);
      setTimeout(() => setToastNotice(null), 3000);
    }
  };

  const videoTracks = tracks.filter((t) => t.kind === Track.Kind.Video);
  const audioTracks = tracks.filter((t) => t.kind === Track.Kind.Audio);
  const isPresenter = sharedMedia && sharedMedia.presenterName === displayName;

  const pinnedTrack = videoTracks.find((t) => t.sid === pinnedTrackSid);
  const unpinnedVideoTracks = pinnedTrack ? videoTracks.filter((t) => t.sid !== pinnedTrackSid) : videoTracks;

  return (
    <div className="call-layout">
      <header className="call-header">
        <div style={{ fontWeight: 700, fontSize: 'clamp(0.95rem, 2vw, 1.15rem)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#a5b4fc' }}>Room:</span> {roomData.name}
          {dataSaverMode && <span className="data-saver-tag">🌿 Data Saver ON</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Data Saver Mode Toggle Button */}
          <button
            className="btn-outline"
            style={{
              padding: '5px 10px',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: '8px',
              borderColor: dataSaverMode ? '#10b981' : undefined,
              color: dataSaverMode ? '#34d399' : undefined,
              background: dataSaverMode ? 'rgba(16,185,129,0.15)' : undefined,
            }}
            onClick={() => {
              const nextState = !dataSaverMode;
              setDataSaverMode(nextState);
              setToastNotice(nextState ? '🌿 Data Saver enabled: Video filters bypassed to save mobile data & CPU.' : '⚡ Full Quality Mode restored.');
              setTimeout(() => setToastNotice(null), 3000);
            }}
            title="Toggle Data Saver Mode (drops filter overhead for weak/mobile networks)"
          >
            {dataSaverMode ? <ZapOff size={12} color="#34d399" /> : <Zap size={12} />}
            {dataSaverMode ? 'Data Saver ON' : 'Data Saver'}
          </button>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Speaking as: <strong style={{ color: '#818cf8', fontWeight: 600 }}>{displayName}</strong>
          </span>
          <button
            className="btn-outline"
            style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '8px' }}
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
              <div style={{ width: '100%', height: '100%', maxHeight: '60vh', borderRadius: '14px', overflow: 'hidden', border: '2px solid #ec4899', boxShadow: '0 8px 32px rgba(236,72,153,0.3)' }}>
                <TrackTile
                  item={pinnedTrack}
                  activeFilter={activeFilter}
                  activeBg={activeBg}
                  isPinned={true}
                  onTogglePin={() => setPinnedTrackSid(null)}
                  isSpeaking={speakingIdentities.has(pinnedTrack.identity)}
                  isDataSaver={dataSaverMode}
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
                isSpeaking={speakingIdentities.has(item.identity)}
                isDataSaver={dataSaverMode}
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
            room={roomRef.current}
            user={user}
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

        {/* ─── Room State Service Modals & Overlays ─── */}
        {showWhiteboard && (
          <WhiteboardModal
            token={token}
            room={roomRef.current}
            roomId={roomData.id}
            isHost={isOwner}
            onClose={() => setShowWhiteboard(false)}
          />
        )}

        {showPolls && (
          <PollsPanel
            token={token}
            room={roomRef.current}
            roomId={roomData.id}
            user={user}
            isHost={isOwner}
            onClose={() => setShowPolls(false)}
          />
        )}

        {showHandRaise && (
          <HandRaiseQueue
            token={token}
            room={roomRef.current}
            roomId={roomData.id}
            user={user}
            isHost={isOwner}
            onHandRaiseCountChange={(count) => setHandRaiseCount(count)}
            onClose={() => setShowHandRaise(false)}
          />
        )}

        {/* Live Subtitles & Captions Overlay */}
        <LiveCaptionsOverlay
          isEnabled={captionsEnabled}
          room={roomRef.current}
          user={user}
          onClose={() => setCaptionsEnabled(false)}
        />
      </div>

      <footer className="call-controls">
        <button className={`control-btn ${!micOn ? 'danger' : ''}`} onClick={toggleMic} title="Toggle Mic">
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        <button className={`control-btn ${!camOn ? 'danger' : ''}`} onClick={toggleCam} title="Toggle Camera">
          {camOn ? <VideoIcon size={20} /> : <VideoOff size={20} />}
        </button>

        {/* ✋ Hand Raising Queue Button */}
        <button
          className={`control-btn ${showHandRaise ? 'active' : ''}`}
          onClick={() => setShowHandRaise((prev) => !prev)}
          title="Virtual Hand Raising & Speaker Queue"
          style={{ position: 'relative', background: handRaiseCount > 0 ? 'rgba(251, 191, 36, 0.2)' : undefined, borderColor: handRaiseCount > 0 ? '#fbbf24' : undefined }}
        >
          <Hand size={20} color={handRaiseCount > 0 ? '#fbbf24' : undefined} />
          {handRaiseCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                background: '#fbbf24',
                color: '#000',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                fontSize: '0.65rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {handRaiseCount}
            </span>
          )}
        </button>

        {/* 📊 Polls & Q&A Button */}
        <button
          className={`control-btn ${showPolls ? 'active' : ''}`}
          onClick={() => setShowPolls((prev) => !prev)}
          title="In-Room Polls & Q&A"
        >
          <BarChart3 size={20} />
        </button>

        {/* 🎨 Collaborative Whiteboard Button */}
        <button
          className={`control-btn ${showWhiteboard ? 'active' : ''}`}
          onClick={() => setShowWhiteboard((prev) => !prev)}
          title="Interactive Collaborative Whiteboard"
        >
          <Edit2 size={20} />
        </button>

        {/* 🎙️ Live Captions Toggle Button */}
        <button
          className={`control-btn ${captionsEnabled ? 'active' : ''}`}
          onClick={() => {
            const next = !captionsEnabled;
            setCaptionsEnabled(next);
            setToastNotice(next ? '🎙️ Live Captions enabled' : 'Live Captions turned off');
            setTimeout(() => setToastNotice(null), 2500);
          }}
          title={captionsEnabled ? "Turn off Live Captions" : "Turn on Live Captions"}
          style={captionsEnabled ? { background: '#10b981', color: '#fff' } : {}}
        >
          <MessageSquareQuote size={20} />
        </button>

        <button
          className="control-btn"
          onClick={() => setShowInCallInvite(true)}
          title="Invite People by Username, Email, or Shareable Link"
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

        {/* Picture-in-Picture (Floating Player) */}
        <button
          className="control-btn"
          onClick={togglePiP}
          title="Picture-in-Picture (Floating Mini Video Window)"
        >
          <Tv size={20} />
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
