# Production-Grade Secure Architecture (v2)
### Multi-party calls + managed media library for injected clips

This revises the earlier plan on two points you raised:
1. **Multiple people per call** → pure P2P mesh doesn't scale past ~4-6 participants (each browser uploads N-1 streams). Production-grade group calling needs an **SFU** (Selective Forwarding Unit) — a media server that each participant sends one stream to, which then forwards it to everyone else.
2. **Security-first, no gallery access** → "predefined clips" must come exclusively from a **server-side media library** the user uploaded in advance, never a live device file picker. This gets enforced architecturally, not just in the UI.

---

## 1. Updated System Diagram

```
                         ┌─────────────────────────────┐
                         │   Auth/API Server (Node.js)   │
                         │   - JWT auth                  │
                         │   - Room mgmt                 │
                         │   - Media upload/library API   │
                         │   - Postgres (users, rooms,    │
                         │     media metadata)            │
                         └───────────┬───────────────────┘
                                     │ REST (HTTPS)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                              │
        ▼                            ▼                              ▼
┌───────────────┐          ┌──────────────────┐          ┌───────────────────┐
│ React Client A │◄────────►│ Signaling Server  │◄────────►│  React Client B    │
│                │  wss://  │ (Socket.io +      │  wss://  │                    │
│                │          │  Redis adapter)   │          │                    │
└───────┬────────┘          └──────────────────┘          └─────────┬──────────┘
        │                                                            │
        │            Media (audio/video), all clients send           │
        │            ONE upstream to the SFU, receive N downstreams   │
        ▼                                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     SFU Cluster (LiveKit, self-hosted)                    │
│              Handles routing for all participants in a room               │
└─────────────────────────────────────────────────────────────────────────┘

┌───────────────────────┐
│ Object Storage (S3-    │  ← predefined clips live here, private bucket,
│ compatible), private    │    served only via short-lived signed URLs
└───────────────────────┘
```

**Why an SFU instead of raw P2P for this version:** with an SFU, each participant uploads their stream once regardless of room size, and the server fans it out. This is what every production video app (Zoom, Meet, Discord) does past 1:1 calls. I'd recommend **LiveKit** — it's open-source, self-hostable (so still free/DIY, just not reinventing the media-routing wheel), has a Node.js server SDK and a React client SDK, and is built specifically for this. Writing your own SFU from scratch (e.g. via raw `mediasoup`) is possible but is a multi-month undertaking on its own — not something to build in a v1 production app.

---

## 2. Security Model

### 2.1 Transport
- **Everything over TLS.** HTTPS for the API, WSS for signaling, and TURN over **TURNS** (TLS) as well — configure via nginx/Caddy + Let's Encrypt.
- WebRTC media itself is **always encrypted** (DTLS-SRTP is mandatory in the spec, not optional) — the SFU forwards encrypted packets without needing to decrypt them for routing.

### 2.2 Authentication & room access
- Users authenticate via your API (JWT, or OAuth via Google/etc. to avoid storing passwords at all).
- Room join requires a **short-lived signed token** issued by your API only after checking the user is a room member/invitee — the SFU (LiveKit) validates this token itself before admitting anyone. No one can join a room by guessing a room ID.
- Room IDs are non-guessable UUIDs, never sequential.

### 2.3 The media library — this is the core safety requirement
This is deliberately **not** "pick any file from your device during a call." It's a two-stage flow:

**Stage 1 — Upload (happens before any call, authenticated, moderated):**
1. User uploads a video/audio file via a dedicated `/api/media/upload` endpoint (not during a live call).
2. Server validates:
   - Real MIME-type via content sniffing (not trusting the file extension) — reject anything that isn't a genuine video/audio container.
   - File size and duration caps (e.g., max 100MB / 3 minutes) to bound resource use.
3. File is scanned for malware (ClamAV or similar) before it's trusted.
4. Server **transcodes** the file with `ffmpeg` to a known-safe standard format/codec. This step is important: it strips any embedded scripts, malformed metadata, or container-level exploits, and guarantees the file that's ever played back is one your own pipeline produced — never the user's raw upload played directly.
5. Clean, transcoded file is stored in a **private** S3-compatible bucket (not public). A DB record links it to the uploading user's account.

**Stage 2 — Injection during a call (runtime, read-only):**
1. The in-call media picker calls an authenticated API that returns only the clips owned by the current user.
2. Playback happens via a **short-lived signed URL** (expires in minutes), never a public/static link.
3. The client captures that authenticated stream via `captureStream()` and swaps it into the WebRTC connection with `replaceTrack()`, same mechanism as before.
4. There is **no filesystem/gallery picker in the call UI at all** — the only source of "clips" the injection component can ever see is this server-validated library. That constraint is enforced by never exposing a native file `<input>` in the call screen, and by having the picker component only ever call the authenticated library API.

### 2.4 Application-layer hardening
| Concern | Mitigation |
|---|---|
| XSS in chat | Sanitize/escape all chat text server-side before storing/broadcasting; never render raw HTML client-side |
| Abuse / spam | Rate-limit chat messages, uploads, and room creation per user/IP (`express-rate-limit`, socket.io middleware) |
| Injection attacks | Parameterized queries via an ORM (e.g., Prisma) — never raw string SQL |
| CORS | Strict allow-list to your own frontend origin only |
| CSP | Content-Security-Policy headers blocking inline scripts, restricting media/img sources to your own storage domain |
| Secrets | JWT secret, DB creds, TURN/LiveKit API keys in environment variables or a secrets manager — never shipped to the client |
| DoS via media | Cap concurrent room size, cap simultaneous injected streams, run transcoding in a background job queue (e.g., BullMQ) so uploads can't block the server |
| Audit trail | Log room joins/leaves, uploads, and moderation actions (without logging chat/media content itself) |

### 2.5 Content moderation (optional but worth flagging given "safety first")
If this app has any multi-user/public dimension (not just private 1:1 friends), consider:
- Manual admin approval before an uploaded clip becomes usable ("pending" → "approved" states).
- Automated review (hash-matching against known-bad content, or a moderation API) before a clip is marked approved.
- A report/block mechanism for users during calls.

---

## 3. Scaling for Production

- **Signaling server**: run multiple Socket.io instances behind a load balancer, sharing state via the Redis adapter (`@socket.io/redis-adapter`) so users on different server instances can still see each other's events.
- **SFU (LiveKit)**: can run as a single node for moderate scale, or as a distributed cluster for larger scale — LiveKit supports both.
- **Storage**: S3 (or compatible) behind a CDN for transcoded clip delivery, still gated by signed URLs.
- **Database**: Postgres, with connection pooling (PgBouncer) if scaling out API instances.
- **Deployment**: Dockerize each service (API, signaling, LiveKit, workers); run behind a reverse proxy (nginx/Caddy) terminating TLS; use a CI/CD pipeline with health checks.

---

## 4. Updated Dependency List

### Client
| Package | Purpose |
|---|---|
| `react`, `react-dom` | UI |
| `livekit-client` | SFU connection, track publishing/subscribing |
| `socket.io-client` | chat + non-media signaling |
| `dompurify` | client-side sanitization defense-in-depth |

### API / Signaling Server
| Package | Purpose |
|---|---|
| `express` | REST API |
| `socket.io` + `@socket.io/redis-adapter` | chat, horizontally scalable |
| `livekit-server-sdk` | issue room access tokens, manage rooms server-side |
| `jsonwebtoken` | auth tokens |
| `prisma` + `postgresql` | DB access, users/rooms/media metadata |
| `multer` + `file-type` | upload handling + real MIME-type detection |
| `fluent-ffmpeg` (wraps `ffmpeg`) | transcoding uploaded clips |
| `bullmq` + `redis` | background job queue for transcoding/scanning |
| `clamscan` (ClamAV binding) | malware scanning uploads |
| `express-rate-limit` | rate limiting |
| `helmet` | security headers (CSP, etc.) |
| `aws-sdk` / `@aws-sdk/client-s3` | private object storage + signed URLs |

### Infra
| Tool | Purpose |
|---|---|
| LiveKit server (self-hosted, Docker) | SFU media routing |
| coturn or LiveKit's built-in TURN | NAT traversal, TURNS over TLS |
| Redis | Socket.io scaling + job queue |
| ClamAV | malware scanning |
| nginx or Caddy | TLS termination, reverse proxy |
| S3-compatible storage (AWS S3, MinIO, etc.) | private clip storage |

---

## 5. Revised Build Order

1. Auth + room management API (JWT, Postgres, room membership).
2. LiveKit self-hosted setup; get a basic multi-party call working (client publishes/subscribes via `livekit-client`, tokens issued by your API).
3. Chat via Socket.io, sanitized both directions.
4. Media upload pipeline: validate → scan → transcode → store privately → DB record. Build this as an **offline, pre-call** flow first.
5. In-call media library picker: authenticated fetch of the user's clips, signed-URL playback, `captureStream()` + `replaceTrack()` injection — reusing the mechanism from the first draft, now sourced only from the secured library.
6. Hardening pass: rate limits, CSP/helmet, audit logging, load testing.
7. Deployment: Dockerize, TLS, Redis-backed scaling, CI/CD.

---

## 6. What Changed From the First Draft

- P2P mesh → **LiveKit SFU** (required for real multi-party at production scale).
- "Pick any predefined clip file" → **mandatory upload-validate-transcode-store pipeline**, with runtime access only through authenticated, signed, short-lived URLs — no direct filesystem/gallery access is ever possible from the call screen.
- Added auth, room tokens, rate limiting, malware scanning, and secure headers throughout, since none of that existed in the v1 sketch.