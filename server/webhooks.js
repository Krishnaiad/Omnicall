import 'dotenv/config';
import { WebhookReceiver } from 'livekit-server-sdk';
import { db, randomUUID } from './db.js';

function getLiveKitCredentials() {
  const apiKey = (process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET || '').trim();
  return { apiKey, apiSecret };
}

/**
 * LiveKit Webhook Handler — Point 1 Fix (Zombie Room Elimination)
 *
 * Registered at POST /api/webhooks/livekit with express.raw() middleware.
 * Verifies HMAC signature on every webhook payload and mutates live_sessions
 * table so the DB stays in sync with LiveKit SFU state in real time.
 *
 * To wire up in LiveKit Cloud dashboard:
 *   Webhook URL: https://your-server.com/api/webhooks/livekit
 *   Events: participant_joined, participant_left, room_finished
 *
 * Events handled:
 *  - participant_joined  → upsert live_sessions row (active session)
 *  - participant_left    → set left_at on the session row
 *  - room_finished       → close ALL active sessions for that room
 */
export async function handleLiveKitWebhook(req, res) {
  const { apiKey, apiSecret } = getLiveKitCredentials();

  if (!apiKey || !apiSecret) {
    console.error('[Webhook] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured');
    return res.status(500).send('Server webhook credentials not configured');
  }

  let event;
  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    // req.body is a Buffer because of express.raw() — convert to UTF-8 string for receiver
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : String(req.body);
    event = receiver.receive(rawBody, req.headers['authorization']);
  } catch (err) {
    console.warn('[Webhook] Signature verification failed:', err.message);
    return res.status(401).send('Invalid webhook signature');
  }

  const eventName = event.event;
  const roomInfo = event.room;
  const participant = event.participant;

  try {
    if (eventName === 'participant_joined' && roomInfo && participant) {
      // Try update first, then insert — compatible with Postgres
      const updated = await db.queryRun(
        `UPDATE live_sessions SET left_at = NULL, disconnect_reason = NULL, joined_at = CURRENT_TIMESTAMP, participant_name = $1
         WHERE room_id = $2 AND participant_identity = $3`,
        [participant.name || participant.identity, roomInfo.name, participant.identity]
      );

      // If no row was updated, insert a fresh row
      const affectedRows = updated?.rowCount ?? updated?.changes ?? 0;
      if (affectedRows === 0) {
        await db.queryRun(
          `INSERT INTO live_sessions (id, room_id, room_name, participant_identity, participant_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), roomInfo.name, roomInfo.name, participant.identity, participant.name || participant.identity]
        ).catch(() => {}); // Ignore duplicate key on concurrent webhooks
      }

      console.log(`[Webhook] ✅ participant_joined  → room: ${roomInfo.name} | user: ${participant.identity}`);

    } else if (eventName === 'participant_left' && roomInfo && participant) {
      await db.queryRun(
        `UPDATE live_sessions SET left_at = CURRENT_TIMESTAMP, disconnect_reason = $1
         WHERE room_id = $2 AND participant_identity = $3 AND left_at IS NULL`,
        [event.disconnectReason || 'unknown', roomInfo.name, participant.identity]
      );
      console.log(`[Webhook] 👋 participant_left  → room: ${roomInfo.name} | user: ${participant.identity}`);

    } else if (eventName === 'room_finished' && roomInfo) {
      await db.queryRun(
        `UPDATE live_sessions SET left_at = CURRENT_TIMESTAMP, disconnect_reason = 'room_finished'
         WHERE room_id = $1 AND left_at IS NULL`,
        [roomInfo.name]
      );
      console.log(`[Webhook] 🏁 room_finished → room: ${roomInfo.name} | closed all active sessions`);
    }
  } catch (err) {
    // Never return 5xx — LiveKit would retry and flood. Log and move on.
    console.error(`[Webhook] DB update failed for event "${eventName}":`, err.message);
  }

  // Always 200 so LiveKit does not retry the webhook
  res.sendStatus(200);
}
