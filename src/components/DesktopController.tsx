import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Track, RoomState } from "../types";
import SoundFieldVisualizer from "./SoundFieldVisualizer";
import TrackList from "./TrackList";
import QrCodeModal from "./QrCodeModal";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  QrCode,
  Smartphone,
  CheckCircle,
  HelpCircle,
  Laptop,
  ArrowRightLeft,
  RotateCw
} from "lucide-react";

// Generate a random room ID (e.g. "MIX42")
function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function DesktopController() {
  const [roomId, setRoomId] = useState<string>("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [desktopVolume, setDesktopVolume] = useState(0.0); // start muted by default to avoid echo/duplication unless intended
  const [listenerOrientation, setListenerOrientation] = useState<[number, number, number, number, number, number]>([0, 0, -1, 0, 1, 0]);
  const [rotationAngle, setRotationAngle] = useState(0); // head rotation angle (yaw) in degrees
  const [mobileConnected, setMobileConnected] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  // Web Audio Context & Gain Nodes for Desktop Audio Spatialization
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const trackAudioMapRef = useRef<
    Record<
      string,
      {
        panner: PannerNode;
        gainNode: GainNode;
        oscillatorSource?: OscillatorNode;
        bufferSource?: AudioBufferSourceNode;
        buffer?: AudioBuffer;
        envelopeTimer?: any;
      }
    >
  >({});

  // Initialize Room ID and Socket Connection
  useEffect(() => {
    // 1. Get room from URL query if available, otherwise generate new one
    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get("room")?.toUpperCase();
    const activeRoom = queryRoom || generateRoomId();
    setRoomId(activeRoom);

    // Update browser URL query without reloading
    if (!queryRoom) {
      window.history.replaceState({}, "", `?room=${activeRoom}`);
    }

    // 2. Establish Socket.io connection to current host
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Desktop] Socket connected, joining room:", activeRoom);
      socket.emit("join-room", activeRoom);
    });

    // 3. Setup listeners
    socket.on("room-state", (state: RoomState) => {
      console.log("[Desktop] Initial room state synced:", state);
      setTracks(state.tracks);
      setPlaying(state.playing);
      setMasterVolume(state.masterVolume);
      setListenerOrientation(state.listenerOrientation);
    });

    socket.on("track-updated", ({ trackId, updates }) => {
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t))
      );
    });

    socket.on("room-updated", (updates) => {
      if (updates.playing !== undefined) setPlaying(updates.playing);
      if (updates.masterVolume !== undefined) setMasterVolume(updates.masterVolume);
      if (updates.listenerOrientation !== undefined) setListenerOrientation(updates.listenerOrientation);
    });

    socket.on("player-connected", () => {
      console.log("[Desktop] Mobile player connected!");
      setMobileConnected(true);
    });

    socket.on("device-motion-relayed", (rotation) => {
      // Rotate the listener based on mobile device orientation (yaw/alpha)
      if (rotation && rotation.alpha !== undefined) {
        // Map alpha rotation (0 to 360) directly to listener angle
        setRotationAngle(-rotation.alpha);
      }
    });

    return () => {
      socket.disconnect();
      // Clean up all local audio context nodes on unmount
      Object.keys(trackAudioMapRef.current).forEach((trackId) => {
        stopAndDestroyLocalTrack(trackId);
      });
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // Convert Base64 file format to ArrayBuffer for Web Audio Decoding
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const base64Clean = base64.includes("base64,") ? base64.split("base64,")[1] : base64;
    const binaryString = window.atob(base64Clean);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const startLocalFileSource = (trackId: string, buffer: AudioBuffer) => {
    const ctx = audioCtxRef.current;
    const mapItem = trackAudioMapRef.current[trackId];
    if (!ctx || !mapItem || !buffer) return;

    if (mapItem.bufferSource) {
      try {
        mapItem.bufferSource.stop();
      } catch (e) {}
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(mapItem.gainNode);
    source.start();

    mapItem.bufferSource = source;
  };

  const startLocalSynthSource = (trackId: string, synthType: "pad" | "lead" | "beat" | "drone") => {
    const ctx = audioCtxRef.current;
    const mapItem = trackAudioMapRef.current[trackId];
    if (!ctx || !mapItem) return;

    if (mapItem.oscillatorSource) {
      try {
        mapItem.oscillatorSource.stop();
      } catch (e) {}
    }

    if (synthType === "pad") {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(196, ctx.currentTime);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, ctx.currentTime);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.2, ctx.currentTime);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(400, ctx.currentTime);

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      osc.connect(filter);
      filter.connect(mapItem.gainNode);
      osc.start();

      mapItem.oscillatorSource = osc;

      let padInterval = setInterval(() => {
        if (!audioCtxRef.current) {
          clearInterval(padInterval);
          return;
        }
        const chordFreqs = [196.0, 220.0, 261.6, 329.6];
        const nextFreq = chordFreqs[Math.floor(Math.random() * chordFreqs.length)];
        osc.frequency.setTargetAtTime(nextFreq, ctx.currentTime, 3.5);
      }, 7000);
      mapItem.envelopeTimer = padInterval;

    } else if (synthType === "lead") {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(329.6, ctx.currentTime);

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.setValueAtTime(1200, ctx.currentTime);
      bandpass.Q.setValueAtTime(2, ctx.currentTime);

      const delay = ctx.createDelay();
      delay.delayTime.setValueAtTime(0.3, ctx.currentTime);
      const delayGain = ctx.createGain();
      delayGain.gain.setValueAtTime(0.35, ctx.currentTime);

      osc.connect(bandpass);
      bandpass.connect(mapItem.gainNode);

      bandpass.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(delay);
      delayGain.connect(mapItem.gainNode);

      osc.start();
      mapItem.oscillatorSource = osc;

      const pentatonic = [392.0, 440.0, 523.2, 587.3, 659.3, 784.0];
      let step = 0;
      let arpInterval = setInterval(() => {
        if (!audioCtxRef.current || !playing) return;
        const trackState = tracks.find((t) => t.id === trackId);
        if (trackState && trackState.playing && trackState.volume > 0.05) {
          const targetFreq = pentatonic[step % pentatonic.length];
          osc.frequency.setValueAtTime(targetFreq, ctx.currentTime);
          bandpass.frequency.setValueAtTime(1600, ctx.currentTime);
          bandpass.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);
          step++;
        }
      }, 300);

      mapItem.envelopeTimer = arpInterval;

    } else if (synthType === "drone") {
      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(55.0, ctx.currentTime);

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(110.5, ctx.currentTime);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.setValueAtTime(120, ctx.currentTime);

      osc1.connect(lowpass);
      osc2.connect(lowpass);
      lowpass.connect(mapItem.gainNode);

      osc1.start();
      osc2.start();

      mapItem.oscillatorSource = osc1;

    } else if (synthType === "beat") {
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      let beatInterval = setInterval(() => {
        if (!audioCtxRef.current || !playing) return;
        const trackState = tracks.find((t) => t.id === trackId);
        if (trackState && trackState.playing) {
          const noiseSource = ctx.createBufferSource();
          noiseSource.buffer = noiseBuffer;

          const filter = ctx.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.setValueAtTime(7000, ctx.currentTime);

          const env = ctx.createGain();
          env.gain.setValueAtTime(1, ctx.currentTime);
          env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

          noiseSource.connect(filter);
          filter.connect(env);
          env.connect(mapItem.gainNode);
          noiseSource.start();
        }
      }, 500);

      mapItem.envelopeTimer = beatInterval;
    }
  };

  const initializeLocalAudioTrack = async (track: Track) => {
    const ctx = audioCtxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return;

    if (trackAudioMapRef.current[track.id]) return;

    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.0;
    panner.maxDistance = 100.0;
    panner.rolloffFactor = 1.0;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;

    panner.positionX.setValueAtTime(track.x, ctx.currentTime);
    panner.positionY.setValueAtTime(track.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(track.z, ctx.currentTime);

    const gainNode = ctx.createGain();
    const targetVolume = track.playing && playing ? track.volume : 0;
    gainNode.gain.setValueAtTime(targetVolume, ctx.currentTime);

    gainNode.connect(panner);
    panner.connect(masterGain);

    trackAudioMapRef.current[track.id] = {
      panner,
      gainNode,
    };

    if (track.type === "synth") {
      startLocalSynthSource(track.id, track.synthType || "pad");
    } else if (track.type === "file" && track.fileData) {
      try {
        const arrayBuffer = base64ToArrayBuffer(track.fileData);
        ctx.decodeAudioData(
          arrayBuffer,
          (decodedBuffer) => {
            if (!trackAudioMapRef.current[track.id]) return;
            trackAudioMapRef.current[track.id].buffer = decodedBuffer;
            if (playing && track.playing) {
              startLocalFileSource(track.id, decodedBuffer);
            }
          },
          (err) => console.error("Error decoding audio on desktop:", err)
        );
      } catch (err) {
        console.error("Failed base64 decode on desktop:", err);
      }
    }
  };

  const stopAndDestroyLocalTrack = (trackId: string) => {
    const mapItem = trackAudioMapRef.current[trackId];
    if (!mapItem) return;

    if (mapItem.oscillatorSource) {
      try { mapItem.oscillatorSource.stop(); } catch (e) {}
    }
    if (mapItem.bufferSource) {
      try { mapItem.bufferSource.stop(); } catch (e) {}
    }
    if (mapItem.envelopeTimer) {
      clearInterval(mapItem.envelopeTimer);
    }

    try { mapItem.gainNode.disconnect(); } catch (e) {}
    try { mapItem.panner.disconnect(); } catch (e) {}

    delete trackAudioMapRef.current[trackId];
  };

  // Helper to lazily initialize Desktop Audio Context on any user interaction or slider change
  const ensureLocalAudioContext = async () => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioCtxRef.current = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(desktopVolume, ctx.currentTime);
      masterGainRef.current = masterGain;

      masterGain.connect(ctx.destination);

      // Initialize all currently existing tracks locally
      tracks.forEach((track) => {
        initializeLocalAudioTrack(track);
      });
    } catch (err) {
      console.error("Failed to initialize local desktop audio context:", err);
    }
  };

  // Synchronize local Web Audio nodes with state changes
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // Update master gain
    if (masterGainRef.current) {
      masterGainRef.current.gain.setTargetAtTime(desktopVolume, ctx.currentTime, 0.05);
    }

    // Update listener orientation based on rotationAngle
    if (ctx.listener) {
      const yawRad = (rotationAngle * Math.PI) / 180;
      const forwardX = Math.sin(yawRad);
      const forwardY = 0;
      const forwardZ = -Math.cos(yawRad);
      const t = ctx.currentTime;
      if (ctx.listener.forwardX) {
        ctx.listener.forwardX.setTargetAtTime(forwardX, t, 0.04);
        ctx.listener.forwardY.setTargetAtTime(forwardY, t, 0.04);
        ctx.listener.forwardZ.setTargetAtTime(forwardZ, t, 0.04);
        ctx.listener.upX.setTargetAtTime(0, t, 0.04);
        ctx.listener.upY.setTargetAtTime(1, t, 0.04);
        ctx.listener.upZ.setTargetAtTime(0, t, 0.04);
      } else {
        ctx.listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
      }
    }

    // Sync individual track parameters
    tracks.forEach((track) => {
      const mapItem = trackAudioMapRef.current[track.id];
      if (!mapItem) {
        initializeLocalAudioTrack(track);
      } else {
        const timeConstant = 0.06;
        mapItem.panner.positionX.setTargetAtTime(track.x, ctx.currentTime, timeConstant);
        mapItem.panner.positionY.setTargetAtTime(track.y, ctx.currentTime, timeConstant);
        mapItem.panner.positionZ.setTargetAtTime(track.z, ctx.currentTime, timeConstant);

        const targetVolume = track.playing && playing ? track.volume : 0;
        mapItem.gainNode.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.04);

        if (playing) {
          if (track.playing) {
            if (track.type === "file" && mapItem.buffer && !mapItem.bufferSource) {
              startLocalFileSource(track.id, mapItem.buffer);
            }
          } else {
            if (track.type === "file" && mapItem.bufferSource) {
              try {
                mapItem.bufferSource.stop();
              } catch (e) {}
              mapItem.bufferSource = undefined;
            }
          }
        } else {
          if (track.type === "file" && mapItem.bufferSource) {
            try {
              mapItem.bufferSource.stop();
            } catch (e) {}
            mapItem.bufferSource = undefined;
          }
          if (track.type === "synth" && mapItem.envelopeTimer) {
            clearInterval(mapItem.envelopeTimer);
            mapItem.envelopeTimer = undefined;
          }
        }
      }
    });

    // Handle deletions
    Object.keys(trackAudioMapRef.current).forEach((trackId) => {
      const stillExists = tracks.some((t) => t.id === trackId);
      if (!stillExists) {
        stopAndDestroyLocalTrack(trackId);
      }
    });
  }, [tracks, playing, desktopVolume, rotationAngle]);

  // Update track volume
  const handleUpdateTrackVolume = (trackId: string, volume: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, volume } : t))
    );
    socketRef.current?.emit("update-track", {
      roomId,
      trackId,
      updates: { volume },
    });
  };

  // Toggle track mute/play
  const handleToggleTrackPlaying = (trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id === trackId) {
          const nextPlaying = !t.playing;
          socketRef.current?.emit("update-track", {
            roomId,
            trackId,
            updates: { playing: nextPlaying },
          });
          return { ...t, playing: nextPlaying };
        }
        return t;
      })
    );
  };

  // Drag node or slider position update
  const handleUpdateTrackPosition = (trackId: string, x: number, y: number, z: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, x, y, z } : t))
    );
    socketRef.current?.emit("update-track", {
      roomId,
      trackId,
      updates: { x, y, z },
    });
  };

  // Master play/pause
  const handleToggleMasterPlay = () => {
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    socketRef.current?.emit("update-room", {
      roomId,
      updates: { playing: nextPlaying },
    });
    if (nextPlaying) {
      ensureLocalAudioContext();
    }
  };

  // Master mobile volume change
  const handleMasterVolumeChange = (volume: number) => {
    setMasterVolume(volume);
    socketRef.current?.emit("update-room", {
      roomId,
      updates: { masterVolume: volume },
    });
  };

  // Local desktop volume change
  const handleDesktopVolumeChange = (volume: number) => {
    setDesktopVolume(volume);
    if (volume > 0) {
      ensureLocalAudioContext();
    }
  };

  // Handle selected track coordinate changes via manual sliders
  const handleCoordinateUpdate = (coord: "x" | "y" | "z", value: number) => {
    if (!selectedTrackId) return;
    const track = tracks.find((t) => t.id === selectedTrackId);
    if (!track) return;

    const nextX = coord === "x" ? value : track.x;
    const nextY = coord === "y" ? value : track.y;
    const nextZ = coord === "z" ? value : track.z;

    handleUpdateTrackPosition(selectedTrackId, nextX, nextY, nextZ);
  };

  // Add custom audio track upload
  const handleAddCustomTrack = (name: string, base64Data: string) => {
    const randomColors = [
      "#10b981", // emerald-500
      "#3b82f6", // blue-500
      "#f43f5e", // rose-500
      "#eab308", // yellow-500
      "#06b6d4", // cyan-500
      "#ec4899", // pink-500
    ];
    const newTrack: Track = {
      id: `custom-track-${Date.now()}`,
      name,
      x: (Math.random() * 4 - 2), // random -2 to 2
      y: 0.0,
      z: (Math.random() * 4 - 2), // random -2 to 2
      volume: 0.7,
      playing: true,
      color: randomColors[Math.floor(Math.random() * randomColors.length)],
      icon: "Music",
      type: "file",
      fileData: base64Data,
    };

    setTracks((prev) => [...prev, newTrack]);
    socketRef.current?.emit("update-track", {
      roomId,
      trackId: newTrack.id,
      updates: newTrack,
    });
  };

  // Delete custom audio track
  const handleDeleteTrack = (trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    // Instruct players to delete or halt playback of deleted track
    socketRef.current?.emit("update-track", {
      roomId,
      trackId,
      updates: { deleted: true },
    });
  };

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

  // Construct mobile player coupling link
  const playerUrl = `${window.location.origin}/player?room=${roomId}`;

  return (
    <div className="min-h-screen bg-bento-bg text-bento-text flex flex-col font-sans selection:bg-bento-accent selection:text-bento-bg">
      {/* 1. Header Area */}
      <header className="border-b border-bento-border bg-bento-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Logo Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-bento-accent/10 border border-bento-accent/30 rounded-xl">
              <RotateCw className="w-5 h-5 text-bento-accent animate-spin-slow" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-bento-text flex items-center gap-2">
                3D Spatial Audio Mixer
              </h1>
              <p className="text-[11px] text-bento-muted font-mono uppercase tracking-wider">
                Dual-Device Spatializer Engine (Web Audio API + Head-Tracking)
              </p>
            </div>
          </div>

          {/* Connection Pairing Widget */}
          <div className="flex items-center gap-3 bg-bento-card border border-bento-border rounded-xl p-2 px-3 shrink-0">
            {/* Status indicators */}
            <div className="flex flex-col text-left">
              <span className="text-[9px] text-bento-muted font-mono">Coupling Mode</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    mobileConnected ? "bg-bento-accent animate-pulse bento-glow-accent" : "bg-amber-500"
                  }`}
                />
                <span className="text-xs font-semibold text-bento-text/90">
                  {mobileConnected ? "Mobile Player Active" : "Waiting for Mobile Coupling"}
                </span>
              </div>
            </div>

            <div className="h-6 w-[1px] bg-bento-border" />

            {/* Room display and QR code trigger */}
            <div className="flex items-center gap-2">
              <div className="bg-bento-bg border border-bento-border px-2.5 py-1 rounded-lg text-xs font-mono font-bold text-bento-accent">
                ROOM: {roomId}
              </div>
              <button
                onClick={() => setIsQrOpen(true)}
                className="flex items-center gap-1.5 bg-bento-accent hover:opacity-90 active:opacity-100 px-3.5 py-1.5 text-xs font-mono font-bold uppercase rounded-lg shadow-md shadow-bento-accent/15 text-bento-bg transition-all cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Pair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Main Workspace Layout */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Space: Visualizer Stage & Selected Node Controller (7 cols) */}
        <section className="lg:col-span-7 flex flex-col">
          <div className="bg-bento-card border border-bento-border rounded-2xl p-5 shadow-xl flex-1 flex flex-col justify-between">
            <SoundFieldVisualizer
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              onSelectTrack={setSelectedTrackId}
              onUpdateTrackPosition={handleUpdateTrackPosition}
              listenerOrientation={listenerOrientation}
              rotationAngle={rotationAngle}
            />

            {/* Precision Coordinate Gizmos */}
            {selectedTrack ? (
              <div className="bg-bento-bg border border-bento-border rounded-xl p-4.5 shadow-inner mt-5 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="flex items-center justify-between mb-4 border-b border-bento-border pb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: selectedTrack.color }}
                    />
                    <h4 className="font-semibold text-xs uppercase tracking-wider text-bento-text">
                      Channel Positioning: <span className="text-bento-accent normal-case">{selectedTrack.name}</span>
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-bento-accent bg-bento-accent/10 border border-bento-accent/20 px-2 py-0.5 rounded-full">
                    {selectedTrack.type === "synth" ? "Oscillator Synth" : "Wave File Source"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Slider X */}
                  <div className="bg-bento-card/50 p-3 rounded-lg border border-bento-border/50">
                    <div className="flex items-center justify-between text-[10px] text-bento-muted font-mono mb-1.5">
                      <span>X (Left / Right)</span>
                      <span className="text-bento-accent font-bold">{selectedTrack.x.toFixed(1)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-5.0"
                      max="5.0"
                      step="0.1"
                      value={selectedTrack.x}
                      onChange={(e) => handleCoordinateUpdate("x", parseFloat(e.target.value))}
                      className="w-full h-1 bg-bento-bg rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
                    />
                    <div className="flex justify-between text-[8px] text-bento-muted font-mono mt-1">
                      <span>-5.0m L</span>
                      <span>+5.0m R</span>
                    </div>
                  </div>

                  {/* Slider Y */}
                  <div className="bg-bento-card/50 p-3 rounded-lg border border-bento-border/50">
                    <div className="flex items-center justify-between text-[10px] text-bento-muted font-mono mb-1.5">
                      <span>Y (Elevation Height)</span>
                      <span className="text-bento-accent font-bold">{selectedTrack.y.toFixed(1)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-5.0"
                      max="5.0"
                      step="0.1"
                      value={selectedTrack.y}
                      onChange={(e) => handleCoordinateUpdate("y", parseFloat(e.target.value))}
                      className="w-full h-1 bg-bento-bg rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
                    />
                    <div className="flex justify-between text-[8px] text-bento-muted font-mono mt-1">
                      <span>-5.0m Down</span>
                      <span>+5.0m Up</span>
                    </div>
                  </div>

                  {/* Slider Z */}
                  <div className="bg-bento-card/50 p-3 rounded-lg border border-bento-border/50">
                    <div className="flex items-center justify-between text-[10px] text-bento-muted font-mono mb-1.5">
                      <span>Z (Front / Rear Depth)</span>
                      <span className="text-bento-accent font-bold">{selectedTrack.z.toFixed(1)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-5.0"
                      max="5.0"
                      step="0.1"
                      value={selectedTrack.z}
                      onChange={(e) => handleCoordinateUpdate("z", parseFloat(e.target.value))}
                      className="w-full h-1 bg-bento-bg rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
                    />
                    <div className="flex justify-between text-[8px] text-bento-muted font-mono mt-1">
                      <span>-5.0m Front</span>
                      <span>+5.0m Rear</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-bento-bg/30 border border-dashed border-bento-border rounded-xl p-6 text-center text-bento-muted text-xs mt-5 font-mono uppercase tracking-wider">
                Click on any sound node above to calibrate coordinate levels and dimensions precisely
              </div>
            )}
          </div>
        </section>

        {/* Right Space: Track Mixer Controls & Custom Audio File Loader (5 cols) */}
        <section className="lg:col-span-5 flex flex-col">
          <TrackList
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            onSelectTrack={setSelectedTrackId}
            onUpdateTrackVolume={handleUpdateTrackVolume}
            onToggleTrackPlaying={handleToggleTrackPlaying}
            onAddCustomTrack={handleAddCustomTrack}
            onDeleteTrack={handleDeleteTrack}
          />
        </section>
      </main>

      {/* 3. Global Master Controls Bar (Sticky Footer) */}
      <footer className="border-t border-bento-border bg-bento-card/85 backdrop-blur-md py-5 px-6 sticky bottom-0 z-10 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-5 justify-between">
          {/* Guide Note */}
          <div className="flex items-center gap-3 max-w-md">
            <Smartphone className="w-5 h-5 text-bento-accent shrink-0 animate-pulse" />
            <div className="text-left">
              <p className="text-xs font-semibold text-bento-text">
                Dual-Output Monitoring Active
              </p>
              <p className="text-[10px] text-bento-muted leading-relaxed">
                Connect a phone for head-tracked <span className="text-bento-accent font-semibold">Mobile Player</span> spatial effects, or unmute the <span className="text-bento-accent font-semibold">Desktop Monitor</span> to experience immersive spatial audio directly!
              </p>
            </div>
          </div>

          {/* Master Volume and Global Play Controls */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
            {/* Global Play / Pause */}
            <button
              onClick={handleToggleMasterPlay}
              className={`w-full sm:w-auto flex items-center justify-center gap-2.5 p-3 px-5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider shadow-lg transition-all cursor-pointer shrink-0 ${
                playing
                  ? "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-rose-600/10"
                  : "bg-bento-accent hover:opacity-90 active:opacity-100 text-bento-bg shadow-bento-accent/15"
              }`}
            >
              {playing ? (
                <>
                  <Pause className="w-4 h-4 fill-white" />
                  <span>Pause Stage</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-bento-bg" />
                  <span>Play Stage</span>
                </>
              )}
            </button>

            {/* Desktop Volume */}
            <div className="flex items-center gap-2 bg-bento-bg border border-bento-border p-2.5 px-3.5 rounded-xl w-full sm:w-52 max-w-xs sm:flex-initial group">
              <div className="flex items-center gap-1.5 text-bento-muted group-hover:text-bento-accent transition-colors shrink-0">
                <Laptop className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider">Desktop</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.0"
                step="0.01"
                value={desktopVolume}
                onChange={(e) => handleDesktopVolumeChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
              />
              <span className="text-[10px] font-mono font-bold text-bento-text w-9 text-right shrink-0">
                {desktopVolume === 0 ? "MUTE" : `${Math.round(desktopVolume * 100)}%`}
              </span>
            </div>

            {/* Mobile Volume */}
            <div className="flex items-center gap-2 bg-bento-bg border border-bento-border p-2.5 px-3.5 rounded-xl w-full sm:w-52 max-w-xs sm:flex-initial group">
              <div className="flex items-center gap-1.5 text-bento-muted group-hover:text-bento-accent transition-colors shrink-0">
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider">Mobile</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.0"
                step="0.01"
                value={masterVolume}
                onChange={(e) => handleMasterVolumeChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
              />
              <span className="text-[10px] font-mono font-bold text-bento-text w-9 text-right shrink-0">
                {masterVolume === 0 ? "MUTE" : `${Math.round(masterVolume * 100)}%`}
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* 4. Pairing QR Dialog Overlay */}
      <QrCodeModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        url={playerUrl}
      />
    </div>
  );
}
