# OmniCall - Secure Multi-Party Video & Collaboration Platform

OmniCall is a production-grade, full-stack video conferencing application built with **React**, **Node.js/Express**, **PostgreSQL**, and **LiveKit**. It goes far beyond simple video calls by offering a suite of real-time collaboration tools, media injection, and robust backend state management.

## ✨ Key Features

### 🎥 High-Performance Video & Audio
- **LiveKit SFU Integration:** Ultra-low latency video routing, data-saver modes, and scalable architecture.
- **Media Injection:** Upload media (Cloudinary/R2) in the dashboard and inject it directly into the call stream, replacing your camera feed with video/audio clips.
- **Dynamic Layouts:** Auto-adjusting video grids with pinning, active speaker detection, and picture-in-picture (PiP) support.
- **Live Captions:** Real-time speech-to-text live captioning overlays.

### 🛠 Real-Time Collaboration
- **Interactive Whiteboard:** Collaborative SVG-based whiteboard with multi-color drawing, erasing, and snapshot saving/downloading. 
- **Live Polls & Q&A:** Host-controlled polling with atomic voting constraints and real-time result broadcasting.
- **Hand Raising Queue:** Monotonic sequence-based hand raising for structured speaker queues and host moderation.
- **Real-Time Chat:** In-call text chat powered by LiveKit DataPackets.

### 🛡 Enterprise-Grade Backend Architecture
- **Race-Condition Safety:** Uses PostgreSQL advisory locks (`pg_advisory_xact_lock`) for monotonic counter updates (e.g., hand raises).
- **Atomic UPSERTS:** Robust webhook handling with `INSERT ... ON CONFLICT DO UPDATE` to prevent duplicate sessions during network flapping.
- **Keyset Pagination:** Scalable cursor-based pagination `(created_at, id)` used for loading extensive whiteboard histories and chat logs.
- **Zombie Session Reconciliation:** A self-healing cron job that cross-references the PostgreSQL database with the LiveKit API to clear orphaned sessions and keep participant counts strictly accurate.
- **Fault-Tolerant Bulk Deletions:** Media deletions use `Promise.allSettled`, caching external storage failures in a `cleanup_failures` table rather than losing database references.

### 🎨 Polished UI / UX
- **Glassmorphism Design:** A cohesive CSS variable theme with modern glass-card layouts.
- **Accessibility:** Screen-reader ready with correct `aria-labels` and keyboard navigable modals.
- **Custom Modals:** Secure confirmation modals for all destructive actions (deleting users, clips, memories, and rooms) to prevent accidental data loss.

## 🚀 Tech Stack

- **Frontend:** React, Vite, Tailwind-inspired CSS architecture, Lucide Icons, LiveKit Client SDK.
- **Backend:** Node.js, Express.js, PostgreSQL (`pg`), LiveKit Server SDK.
- **Storage:** Cloudinary / Cloudflare R2 for media and memory snapshot storage.

---

## 💻 Running the Application

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL (v14+)
- LiveKit Server (Local or Cloud)

### 2. Environment Variables

Create a `.env` file in the `webapp/server` directory:

```env
# Server configs
PORT=4000
JWT_SECRET=your_super_secret_jwt_key
DATABASE_URL=postgresql://user:pass@localhost:5432/omnicall

# LiveKit Configs
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_WS_URL=wss://your-livekit-server.com

# Storage (Cloudinary/R2)
CLOUDINARY_URL=cloudinary://...
```

### 3. Start the Backend Server
```bash
cd webapp/server
npm install
npm run dev         # Starts server on http://localhost:4000
```
*(The server will automatically run the schema setup and migrations on first boot).*

### 4. Start the Frontend Application
```bash
cd webapp/client
npm install
npm run dev         # Starts Vite client on http://localhost:5173
```

## 🔐 Admin Access
To access the Admin Directory and System Health metrics, register an account with the role `admin` directly via the database, or use the pre-configured credentials if seeded.
