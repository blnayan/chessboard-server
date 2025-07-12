import { Chess } from "chess.js";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import * as z from "zod";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  /* options */
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

interface Room {
  id: string;
  white?: string;
  black?: string;
  chess: Chess;
  connectedSockets: Set<string>;
}

const closedRooms = new Map<string, Room>();
const openRooms = new Map<string, Room>();

app.get("/newgame", (req, res) => {
  // Handle new room creation
  if (openRooms.size === 0) {
    const roomId = uuidv4();
    const playerId = uuidv4();
    const newRoom: Room = {
      id: roomId,
      white: playerId,
      black: undefined,
      chess: new Chess(),
      connectedSockets: new Set(),
    };
    openRooms.set(roomId, newRoom);
    res.json({ roomId, playerId });
  } else {
    const [roomId, room] = openRooms.entries().next().value as [string, Room];
    const playerId = uuidv4();
    room.black = playerId;
    closedRooms.set(roomId, room);
    openRooms.delete(roomId);
    res.json({ roomId, playerId });
  }
});

const JoinRoomData = z.object({
  roomId: z.string(),
  playerId: z.string(),
});

const MoveData = z.object({
  roomId: z.string(),
  playerId: z.string(),
  move: z.string(),
});

io.on("connection", (socket) => {
  socket.on("joinRoom", (data) => {
    const { roomId, playerId } = JoinRoomData.parse(data);

    const room = closedRooms.get(roomId) || openRooms.get(roomId);
    if (!room) {
      socket.emit("error", "Room does not exist");
      return;
    }

    // Verify player is part of this room
    if (room.white !== playerId && room.black !== playerId) {
      socket.emit("error", "You are not part of this game");
      return;
    }

    socket.join(roomId);
    console.log(`Player ${playerId} joined room ${roomId}`);

    room.connectedSockets.add(socket.id);

    // Send current game state to the joining player
    socket.emit("gameState", room.chess.fen());

    if (room.connectedSockets.size === 2) {
      io.to(roomId).emit("bothPlayersReady");
    }
  });

  socket.on("move", (data) => {
    const { roomId, playerId, move } = MoveData.parse(data);

    const room = closedRooms.get(roomId);
    if (!room) {
    }
  });
});

httpServer.listen(4000);
