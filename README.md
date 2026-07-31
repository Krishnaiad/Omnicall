# OmniCall - Secure Multi-Party Video Platform (LiveKit SFU)

Full production-grade implementation of the secure multi-party video call platform based on `architecture.md`.

## Structure

```
webapp/
├── server/               # Express backend API & Socket.io server
│   ├── db.js             # SQLite / Postgres database layer
│   ├── auth.js           # Registration, login, password hashing, JWT
│   ├── room.js           # Room management, invitations, LiveKit token issuance
│   ├── media.js          # Authenticated media upload, MIME check & FFmpeg transcoding
│   ├── index.js          # Server entrypoint with Helmet, CORS & Socket.io chat
│   └── tests/            # Integration & unit test suite
│       └── api.test.js
└── client/               # React + Vite frontend UI
    ├── src/
    │   ├── api.js        # REST client helper
    │   ├── AuthScreen.jsx# Login & sign-up forms
    │   ├── Dashboard.jsx # Room management & pre-call media library
    │   ├── CallScreen.jsx# Multi-party video grid & call control bar
    │   ├── MediaInjector.jsx # In-call pre-uploaded clip injection
    │   └── ChatPanel.jsx # Real-time Socket.io text chat (sanitized)
    └── package.json
```

## Running the Application

### 1. Start backend server
```bash
cd webapp/server
npm install
npm test            # Runs the backend integration test suite
npm run dev         # Starts server on http://localhost:4000
```

### 2. Start frontend app
```bash
cd webapp/client
npm install
npm run dev         # Starts Vite client on http://localhost:5173
```

### 3. Run LiveKit server locally (Docker)
```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey: secret_at_least_32_characters_long" \
  livekit/livekit-server --dev
```