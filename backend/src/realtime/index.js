import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { ROOM_BY_ROLE } from '../config/constants.js';

let io = null;

/**
 * Initialise Socket.IO. Clients must present a valid JWT in the handshake
 * (`auth.token`); roles are read from the verified user, never from client data.
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

      const user = await User.findById(payload.sub).select('role isSuspended');
      if (!user || user.isSuspended) return next(new Error('unauthorized'));

      // Trust only the verified DB role.
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { role, userId } = socket.data;

    const roleRoom = ROOM_BY_ROLE[role];
    if (roleRoom) socket.join(roleRoom);
    // Personal room so a reporter sees updates on their own reports.
    socket.join(`user:${userId}`);

    socket.emit('connected', { userId, role, room: roleRoom || null });
  });

  return io;
}

export function getIO() {
  return io;
}

/** Emit an event to one or more rooms (no-op if realtime isn't initialised). */
export function emitToRooms(rooms, event, payload) {
  if (!io) return;
  const targets = Array.isArray(rooms) ? rooms : [rooms];
  io.to(targets).emit(event, payload);
}
