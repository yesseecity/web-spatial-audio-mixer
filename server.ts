import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // In-memory store for room states.
  // This serves as the server-side source of truth.
  const rooms: Record<string, {
    roomId: string;
    tracks: Array<{
      id: string;
      name: string;
      x: number; // left/right (-5 to +5)
      y: number; // up/down (-5 to +5)
      z: number; // forward/backward (-5 to +5)
      volume: number; // 0 to 1
      playing: boolean;
      color: string;
      icon: string;
      type: "synth" | "file";
      synthType: "pad" | "lead" | "beat" | "drone";
    }>;
    playing: boolean;
    masterVolume: number;
    listenerPosition: [number, number, number];
    listenerOrientation: [number, number, number, number, number, number]; // forward vector (3) + up vector (3)
  }> = {};

  io.on("connection", (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join room
    socket.on("join-room", (roomId: string) => {
      socket.join(roomId);
      console.log(`[Socket.io] Client ${socket.id} joined room: ${roomId}`);

      // If room doesn't exist, bootstrap the default state
      if (!rooms[roomId]) {
        rooms[roomId] = {
          roomId,
          tracks: [
            { id: "track-1", name: "Cosmic Pad", x: -2.5, y: 1.0, z: -2.0, volume: 0.8, playing: true, color: "#8b5cf6", icon: "Waves", type: "synth", synthType: "pad" },
            { id: "track-2", name: "Arp Pulsar", x: 2.5, y: -0.5, z: -1.5, volume: 0.6, playing: true, color: "#ec4899", icon: "Activity", type: "synth", synthType: "lead" },
            { id: "track-3", name: "Deep Drone", x: 0.0, y: -2.0, z: -3.5, volume: 0.7, playing: true, color: "#eab308", icon: "Mic", type: "synth", synthType: "drone" },
            { id: "track-4", name: "Techno Click", x: -1.0, y: -1.5, z: 2.5, volume: 0.5, playing: false, color: "#06b6d4", icon: "Disc", type: "synth", synthType: "beat" }
          ],
          playing: false,
          masterVolume: 0.8,
          listenerPosition: [0, 0, 0],
          listenerOrientation: [0, 0, -1, 0, 1, 0] // looking at -Z, up is Y
        };
      }

      // Send current state to the client that just joined
      socket.emit("room-state", rooms[roomId]);
    });

    // Handle single track updates (position, volume, toggle mute, etc.)
    socket.on("update-track", ({ roomId, trackId, updates }) => {
      if (rooms[roomId]) {
        const room = rooms[roomId];
        const track = room.tracks.find((t) => t.id === trackId);
        if (track) {
          Object.assign(track, updates);
          // Broadcast to other sockets in the same room
          socket.to(roomId).emit("track-updated", { trackId, updates });
        }
      }
    });

    // Handle overall room state updates (play, pause, masterVolume, listener coordinates)
    socket.on("update-room", ({ roomId, updates }) => {
      if (rooms[roomId]) {
        Object.assign(rooms[roomId], updates);
        socket.to(roomId).emit("room-updated", updates);
      }
    });

    // Mobile player lets desktop know it is listening and audio is ready
    socket.on("player-ready", ({ roomId }) => {
      console.log(`[Socket.io] Player device is active in room: ${roomId}`);
      socket.to(roomId).emit("player-connected");
    });

    // Relay gyroscope/orientation events from Mobile Player to Desktop Controller (for visual sync)
    socket.on("device-motion", ({ roomId, rotation }) => {
      // Broadcast to other clients (desktop)
      socket.to(roomId).emit("device-motion-relayed", rotation);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  // Health endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRooms: Object.keys(rooms).length });
  });

  // Serve Frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] All-in-One Spatial Mixer Server boot complete.`);
    console.log(`[Server] Port: ${PORT} | Mode: ${process.env.NODE_ENV || "development"}`);
  });
}

startServer();
