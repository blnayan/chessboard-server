import { Chess, Color } from "chess.js";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import * as z from "zod";
import cors from "cors";

const JoinRoomData = z.object({
  roomId: z.string(),
  playerId: z.string(),
  playerColor: z.enum(["w", "b"]),
});

type JoinRoomDataType = z.infer<typeof JoinRoomData>;

const MoveData = z.object({
  roomId: z.string(),
  playerId: z.string(),
  move: z.object({
    from: z.string(),
    to: z.string(),
    promotion: z.string().optional(),
  }),
});

type MoveDataType = z.infer<typeof MoveData>;

interface ServerToClientEvents {
  error: (message: string) => void;
  roomJoined: (data: JoinRoomDataType) => void;
  bothPlayersReady: () => void;
  moveMade: (move: MoveDataType["move"], moveColor: Color) => void;
  gameOver: (data: { winner?: Color }) => void;
}

interface ClientToServerEvents {
  joinRoom: (data: JoinRoomDataType) => void;
  move: (data: MoveDataType) => void;
}

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://your-frontend.vercel.app",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

interface Room {
  id: string;
  white?: string;
  black?: string;
  chess: Chess;
  connectedSockets: Set<string>;
}

const socketRooms = new Map<string, string>();
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

    res.json({ roomId, playerId, playerColor: "w" });
    return;
  } else {
    const [roomId, room] = openRooms.entries().next().value as [string, Room];
    const playerId = uuidv4();
    room.black = playerId;

    closedRooms.set(roomId, room);
    openRooms.delete(roomId);

    res.json({ roomId, playerId, playerColor: "b" });
    return;
  }
});

// app.get("/isRoomOpen", (req, res) => {
//   const roomId = req.query.roomId;
//   if (typeof roomId !== "string") {
//     res.json(false);
//     return;
//   }

//   const room = openRooms.get(roomId) || closedRooms.get(roomId);
//   if (!room) {
//     res.json(false);
//     return;
//   }

//   res.json(true);
//   return;
// });

let socketConnections = 0;
io.on("connection", (socket) => {
  socketConnections++;
  console.log("Socket connections", socketConnections);
  socket.on("joinRoom", (data) => {
    const { roomId, playerId, playerColor } = JoinRoomData.parse(data);

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

    // Verify color matches the player's role in the room
    if (
      (room.white === playerId && playerColor !== "w") ||
      (room.black === playerId && playerColor !== "b")
    ) {
      socket.emit("error", "Invalid color");
      return;
    }

    if (room.connectedSockets.has(socket.id)) return;

    socket.join(roomId);
    console.log(`Player ${playerId} joined room ${roomId}`);

    socketRooms.set(socket.id, roomId);
    room.connectedSockets.add(socket.id);

    // Send current game state to the joining player
    socket.emit("roomJoined", {
      roomId,
      playerId,
      playerColor: room.white === playerId ? "w" : "b",
    });

    if (room.connectedSockets.size === 2) {
      io.to(roomId).emit("bothPlayersReady");
    }
  });

  socket.on("move", (data) => {
    const { roomId, playerId, move } = MoveData.parse(data);

    const room = closedRooms.get(roomId);
    if (!room) {
      socket.emit("error", "Room does not exist");
      return;
    }

    // Verify player is part of this room
    if (room.white !== playerId && room.black !== playerId) {
      socket.emit("error", "You are not part of this game");
      return;
    }

    if (room.chess.turn() !== (room.white === playerId ? "w" : "b")) {
      socket.emit("error", "It's not your turn");
      return;
    }

    // Make the move
    try {
      room.chess.move(move);
      io.to(roomId).emit("moveMade", move, room.white === playerId ? "w" : "b");

      if (room.chess.isGameOver()) {
        io.to(roomId).emit("gameOver", {
          winner: room.chess.isDraw()
            ? undefined
            : room.chess.turn() === "w"
            ? "b"
            : "w",
        });

        io.to(roomId).disconnectSockets(true);
      }

      return;
    } catch (error) {
      socket.emit("error", "Invalid move");
      return;
    }
  });

  socket.on("disconnect", () => {
    socketConnections--;
    console.log("Socket connections", socketConnections);
    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;

    io.to(roomId).disconnectSockets(true);

    closedRooms.delete(roomId);
    openRooms.delete(roomId);
    socketRooms.delete(socket.id);
  });
});

httpServer.listen(4000);
