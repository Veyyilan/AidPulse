import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { ROOMS, NEED_TYPES } from '../config/constants.js';

let io = null;

/**
 * Initialise Socket.IO. Clients must present a valid JWT in the handshake
 * (`auth.token`). Rooms are derived ONLY from the verified database role and
 * capabilities — never from client-supplied data.
 *
 *   every user   -> user:<id>
 *   ngo          -> ngo, cap:<capability> for each capability
 *   government   -> government
 */
export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, methods: ['GET', 'POST'] },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));

      let payload;
      try {
        payload = verifyToken(token);
      } catch {
        return next(new Error('unauthorized'));
      }

      const user = await User.findById(payload.sub).select('role capabilities isSuspended');
      if (!user || user.isSuspended) return next(new Error('unauthorized'));

      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.data.capabilities = Array.isArray(user.capabilities) ? user.capabilities : [];
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { role, userId, capabilities } = socket.data;

    socket.join(ROOMS.user(userId));

    if (role === 'ngo') {
      socket.join(ROOMS.ngo);
      for (const cap of capabilities) {
        if (NEED_TYPES.includes(cap)) socket.join(ROOMS.capability(cap));
      }
    } else if (role === 'government') {
      socket.join(ROOMS.government);
    }

    socket.emit('connected', { userId, role, rooms: [...socket.rooms] });
  });

  return io;
}

export function getIO() {
  return io;
}

/**
 * Disconnect every live socket belonging to a user (used when an account is
 * suspended). Returns the number of sockets closed. No-op if realtime is not
 * initialised.
 */
export function disconnectUser(userId) {
  if (!io || !userId) return 0;
  const room = ROOMS.user(String(userId));
  const ids = io.sockets.adapter.rooms.get(room);
  if (!ids) return 0;
  let closed = 0;
  for (const id of [...ids]) {
    const socket = io.sockets.sockets.get(id);
    if (socket) {
      socket.disconnect(true);
      closed += 1;
    }
  }
  return closed;
}

/** Emit an event to one or more rooms (no-op if realtime isn't initialised). */
export function emitToRooms(rooms, event, payload) {
  if (!io) return;
  const targets = (Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean);
  if (targets.length === 0) return;
  io.to(targets).emit(event, payload);
}

/**
 * Room fan-out for a report-level event:
 *   government + one capability room per need type present.
 */
export function reportRooms(report) {
  const needs = Array.isArray(report?.needs) ? report.needs : [];
  const capRooms = [...new Set(needs.map((n) => ROOMS.capability(n.type)))];
  return [ROOMS.government, ...capRooms];
}

/** Room fan-out for a single-need event: reporter + government + capability. */
export function needRooms(report, needType) {
  return [ROOMS.user(String(report.reportedBy)), ROOMS.government, ROOMS.capability(needType)];
}
