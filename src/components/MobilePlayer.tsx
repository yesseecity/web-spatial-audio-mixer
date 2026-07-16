import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Track, RoomState, DeviceRotation } from "../types";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Smartphone,
  Compass,
  Radio,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sliders,
  AudioLines
} from "lucide-react";

export default function MobilePlayer() {
  const [roomId, setRoomId] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [audioContextActive, setAudioContextActive] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sensorPermission, setSensorPermission] = useState<"default" | "granted" | "denied">("default");
  const [rotation, setRotation] = useState<DeviceRotation>({ alpha: 0, beta: 0, gamma: 0 });
  const [calibrationAngle, setCalibrationAngle] = useState(0); // center orientation offset

  const [tracks, setTracks] = useState<Track[]>([]);

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Reference map for track audio sources and panning structures
  // Key: trackId
  const trackAudioMapRef = useRef<
    Record<
      string,
      {
        panner: PannerNode;
        gainNode: GainNode;
        // Synth specific:
        oscillatorSource?: OscillatorNode;
        envelopeTimer?: any;
        // Custom File specific:
        buffer?: AudioBuffer;
        bufferSource?: AudioBufferSourceNode;
      }
    >
  >({});

  // Sync Room ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get("room")?.toUpperCase();
    if (queryRoom) {
      setRoomId(queryRoom);
    } else {
      setRoomId("DEMO");
    }
  }, []);

  // Web Sockets Synchronizer Setup
  useEffect(() => {
    if (!roomId) return;

    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Mobile] Joined room:", roomId);
      socket.emit("join-room", roomId);
      setIsConnected(true);
    });

    socket.on("room-state", (state: RoomState) => {
      console.log("[Mobile] Full room state synced:", state);
      setTracks(state.tracks);
      setIsPlaying(state.playing);
      setMasterVolume(state.masterVolume);

      // Handle updates if AudioContext is already running
      if (audioCtxRef.current) {
        syncAudioState(state.tracks, state.playing, state.masterVolume);
      }
    });

    socket.on("track-updated", ({ trackId, updates }) => {
      setTracks((prev) => {
        const index = prev.findIndex((t) => t.id === trackId);
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = { ...updated[index], ...updates };

          // Real-time track-level parameters update
          if (audioCtxRef.current) {
            updateAudioTrackParameters(updated[index]);
          }
          return updated;
        } else if (updates.id) {
          // Dynamic custom track added
          const updated = [...prev, updates as Track];
          if (audioCtxRef.current) {
            initializeAudioTrack(updates as Track);
          }
          return updated;
        }
        return prev;
      });
    });

    socket.on("room-updated", (updates) => {
      if (updates.playing !== undefined) {
        setIsPlaying(updates.playing);
        if (audioCtxRef.current) {
          toggleGlobalPlayback(updates.playing);
        }
      }
      if (updates.masterVolume !== undefined) {
        setMasterVolume(updates.masterVolume);
        if (masterGainRef.current && audioCtxRef.current) {
          masterGainRef.current.gain.setTargetAtTime(updates.masterVolume, audioCtxRef.current.currentTime, 0.05);
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  // Helper: Convert Base64 file format to ArrayBuffer for Web Audio Decoding
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    // Strip header prefix if present (e.g. data:audio/mp3;base64,)
    const base64Clean = base64.includes("base64,") ? base64.split("base64,")[1] : base64;
    const binaryString = window.atob(base64Clean);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  // Web Audio API and Synthesizers Initialization Engine
  const startAudioEngine = async () => {
    if (audioContextActive) return;

    try {
      // 1. Initialize Audio Context
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioCtxRef.current = ctx;

      // 2. Setup Master Gain and Analyser
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(masterVolume, ctx.currentTime);
      masterGainRef.current = masterGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      // Connections: [Tracks] -> Panner -> Gain -> MasterGain -> Analyser -> Output
      masterGain.connect(analyser);
      analyser.connect(ctx.destination);

      // 3. Request Gyroscope / Device Orientation sensors permissions
      setupSensors();

      // 4. Initialize Panners for existing track list
      setAudioContextActive(true);
      socketRef.current?.emit("player-ready", { roomId });

      // Initialize all tracks
      for (const track of tracks) {
        await initializeAudioTrack(track);
      }

      // Resume context if suspended (browser behavior)
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Set global playback state
      toggleGlobalPlayback(isPlaying);

      console.log("[Mobile] Spatial Audio Engine active and connected.");
    } catch (err) {
      console.error("[Mobile] Failed to start audio context:", err);
    }
  };

  // Create PannerNode and source routing for a single track
  const initializeAudioTrack = async (track: Track) => {
    const ctx = audioCtxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return;

    // Check if track is already initialized
    if (trackAudioMapRef.current[track.id]) {
      // Handle deletions or mutations
      return;
    }

    // 1. Create spatial panner
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.0;
    panner.maxDistance = 100.0;
    panner.rolloffFactor = 1.0;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;

    // Set initial coordinates
    panner.positionX.setValueAtTime(track.x, ctx.currentTime);
    panner.positionY.setValueAtTime(track.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(track.z, ctx.currentTime);

    // 2. Create channel level gain node
    const gainNode = ctx.createGain();
    const targetVolume = track.playing && isPlaying ? track.volume : 0;
    gainNode.gain.setValueAtTime(targetVolume, ctx.currentTime);

    // Route: [Source] -> GainNode -> Panner -> MasterGain
    gainNode.connect(panner);
    panner.connect(masterGain);

    trackAudioMapRef.current[track.id] = {
      panner,
      gainNode,
    };

    // 3. Setup audio generator source (Synth or File Buffer)
    if (track.type === "synth") {
      startSynthSource(track.id, track.synthType || "pad");
    } else if (track.type === "file" && track.fileData) {
      try {
        const arrayBuffer = base64ToArrayBuffer(track.fileData);
        ctx.decodeAudioData(
          arrayBuffer,
          (decodedBuffer) => {
            trackAudioMapRef.current[track.id].buffer = decodedBuffer;
            if (isPlaying && track.playing) {
              startFileSource(track.id, decodedBuffer);
            }
          },
          (err) => console.error(`Error decoding custom file '${track.name}':`, err)
        );
      } catch (err) {
        console.error("Failed decoding base64 audio file:", err);
      }
    }
  };

  // Synthesizers Wave Generators (Run in loops)
  const startSynthSource = (trackId: string, synthType: "pad" | "lead" | "beat" | "drone") => {
    const ctx = audioCtxRef.current;
    const mapItem = trackAudioMapRef.current[trackId];
    if (!ctx || !mapItem) return;

    // Stop current source if exists
    if (mapItem.oscillatorSource) {
      try {
        mapItem.oscillatorSource.stop();
      } catch (e) {}
    }

    if (synthType === "pad") {
      // Warm swirly pad chords using Triangle waves with an LFO filter
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      // Let's alternate chord frequency: play G3 (196Hz)
      osc.frequency.setValueAtTime(196, ctx.currentTime);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, ctx.currentTime);

      // Low frequency modulator for sweep
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.2, ctx.currentTime); // 0.2 Hz cycle
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(400, ctx.currentTime); // modulates filter cutoff by +/- 400Hz

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      // Connections: osc -> filter -> gainNode
      osc.connect(filter);
      filter.connect(mapItem.gainNode);
      osc.start();

      mapItem.oscillatorSource = osc;

      // Custom continuous pitch modulator to make chords sound alive
      let padInterval = setInterval(() => {
        if (!audioCtxRef.current) {
          clearInterval(padInterval);
          return;
        }
        const chordFreqs = [196.0, 220.0, 261.6, 329.6]; // G3, A3, C4, E4 chords roots
        const nextFreq = chordFreqs[Math.floor(Math.random() * chordFreqs.length)];
        osc.frequency.setTargetAtTime(nextFreq, ctx.currentTime, 3.5); // long glides
      }, 7000);
      mapItem.envelopeTimer = padInterval;

    } else if (synthType === "lead") {
      // Snappy pentatonic arpeggiator Lead
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(329.6, ctx.currentTime); // E4 default

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.setValueAtTime(1200, ctx.currentTime);
      bandpass.Q.setValueAtTime(2, ctx.currentTime);

      // Delay feedback effect to sound majestic
      const delay = ctx.createDelay();
      delay.delayTime.setValueAtTime(0.3, ctx.currentTime);
      const delayGain = ctx.createGain();
      delayGain.gain.setValueAtTime(0.35, ctx.currentTime);

      // Route: osc -> bandpass -> gainNode
      // Also route bandpass -> delay -> delayGain -> delay (feedback loop) -> gainNode
      osc.connect(bandpass);
      bandpass.connect(mapItem.gainNode);

      bandpass.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(delay); // feedback
      delayGain.connect(mapItem.gainNode); // send delay wet signal to channel gain

      osc.start();
      mapItem.oscillatorSource = osc;

      // Arpeggiator Clock loop (triggered every 300ms)
      const pentatonic = [392.0, 440.0, 523.2, 587.3, 659.3, 784.0]; // G4, A4, C5, D5, E5, G5
      let step = 0;
      let arpInterval = setInterval(() => {
        if (!audioCtxRef.current || !isPlaying) return;
        
        // Grab current gain state to only play note triggers if track is active and audible
        const trackState = tracks.find((t) => t.id === trackId);
        if (trackState && trackState.playing && trackState.volume > 0.05) {
          const targetFreq = pentatonic[step % pentatonic.length];
          osc.frequency.setValueAtTime(targetFreq, ctx.currentTime);

          // Simulate snappy synth lead envelope
          bandpass.frequency.setValueAtTime(1600, ctx.currentTime);
          bandpass.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);
          
          step++;
        }
      }, 300);

      mapItem.envelopeTimer = arpInterval;

    } else if (synthType === "drone") {
      // Deep sub harmonic bass drone
      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(55.0, ctx.currentTime); // A1 bass chord anchor

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(110.5, ctx.currentTime); // slightly detuned A2 to create a natural chorus

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.setValueAtTime(120, ctx.currentTime);

      osc1.connect(lowpass);
      osc2.connect(lowpass);
      lowpass.connect(mapItem.gainNode);

      osc1.start();
      osc2.start();

      mapItem.oscillatorSource = osc1; // store reference to osc1 (others clean up natively on stop)

    } else if (synthType === "beat") {
      // White-noise based rhythm hi-hat / techno click beat
      // Generate noise buffer
      const bufferSize = ctx.sampleRate * 2; // 2 seconds
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      // Interval trigger beat loop (every 500ms -> 120bpm click)
      let beatInterval = setInterval(() => {
        if (!audioCtxRef.current || !isPlaying) return;

        const trackState = tracks.find((t) => t.id === trackId);
        if (trackState && trackState.playing) {
          // Play click noise transient
          const noiseSource = ctx.createBufferSource();
          noiseSource.buffer = noiseBuffer;

          const filter = ctx.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.setValueAtTime(7000, ctx.currentTime);

          const env = ctx.createGain();
          env.gain.setValueAtTime(1, ctx.currentTime);
          env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05); // decay clicks

          noiseSource.connect(filter);
          filter.connect(env);
          env.connect(mapItem.gainNode);
          noiseSource.start();
        }
      }, 500);

      mapItem.envelopeTimer = beatInterval;
    }
  };

  // Launch uploaded wave file sources
  const startFileSource = (trackId: string, buffer: AudioBuffer) => {
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

  // Synchronize parameter changes from incoming WebSocket frame updates
  const updateAudioTrackParameters = (track: Track) => {
    const ctx = audioCtxRef.current;
    const mapItem = trackAudioMapRef.current[track.id];
    if (!ctx || !mapItem) return;

    // Handle deletion
    if ((track as any).deleted) {
      stopAndDestroyTrack(track.id);
      return;
    }

    // Smooth coordinate transition using setTargetAtTime to prevent glitch popping
    const timeConstant = 0.06; // response inertia (seconds)
    mapItem.panner.positionX.setTargetAtTime(track.x, ctx.currentTime, timeConstant);
    mapItem.panner.positionY.setTargetAtTime(track.y, ctx.currentTime, timeConstant);
    mapItem.panner.positionZ.setTargetAtTime(track.z, ctx.currentTime, timeConstant);

    // Apply track volume envelope
    const targetVolume = track.playing && isPlaying ? track.volume : 0;
    mapItem.gainNode.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.04);

    // If play status toggled while globally running, make sure to start sources if needed
    if (isPlaying) {
      if (track.playing) {
        if (track.type === "file" && mapItem.buffer && !mapItem.bufferSource) {
          startFileSource(track.id, mapItem.buffer);
        }
      } else {
        if (track.type === "file" && mapItem.bufferSource) {
          try {
            mapItem.bufferSource.stop();
          } catch (e) {}
          mapItem.bufferSource = undefined;
        }
      }
    }
  };

  // Stop single track source and dispose
  const stopAndDestroyTrack = (trackId: string) => {
    const mapItem = trackAudioMapRef.current[trackId];
    if (!mapItem) return;

    if (mapItem.oscillatorSource) {
      try {
        mapItem.oscillatorSource.stop();
      } catch (e) {}
    }
    if (mapItem.bufferSource) {
      try {
        mapItem.bufferSource.stop();
      } catch (e) {}
    }
    if (mapItem.envelopeTimer) {
      clearInterval(mapItem.envelopeTimer);
    }

    mapItem.gainNode.disconnect();
    mapItem.panner.disconnect();

    delete trackAudioMapRef.current[trackId];
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  };

  // Sync entire state on room load
  const syncAudioState = (allTracks: Track[], isGlobalPlaying: boolean, globalMasterVolume: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (masterGainRef.current) {
      masterGainRef.current.gain.setTargetAtTime(globalMasterVolume, ctx.currentTime, 0.05);
    }

    allTracks.forEach((track) => {
      if (!trackAudioMapRef.current[track.id]) {
        initializeAudioTrack(track);
      } else {
        updateAudioTrackParameters(track);
      }
    });
  };

  // Handle global play / pause trigger
  const toggleGlobalPlayback = (globalPlay: boolean) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    tracks.forEach((track) => {
      const mapItem = trackAudioMapRef.current[track.id];
      if (!mapItem) return;

      const targetVolume = track.playing && globalPlay ? track.volume : 0;
      mapItem.gainNode.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.05);

      if (globalPlay) {
        // Start playing
        if (track.type === "synth") {
          // Restart synthesis arpeggiator clocks or oscillations
          startSynthSource(track.id, track.synthType || "pad");
        } else if (track.type === "file" && mapItem.buffer && !mapItem.bufferSource && track.playing) {
          startFileSource(track.id, mapItem.buffer);
        }
      } else {
        // Pause playing (mutes/stops file buffers)
        if (track.type === "file" && mapItem.bufferSource) {
          try {
            mapItem.bufferSource.stop();
          } catch (e) {}
          mapItem.bufferSource = undefined;
        }
        if (track.type === "synth" && mapItem.envelopeTimer) {
          clearInterval(mapItem.envelopeTimer);
        }
      }
    });
  };

  // Permissions requesting for Mobile Sensors (accelerometer/gyroscope)
  const setupSensors = () => {
    if (typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      // alpha: yaw (0 to 360), beta: pitch (-180 to 180), gamma: roll (-90 to 90)
      const alpha = e.alpha !== null ? e.alpha : 0;
      const beta = e.beta !== null ? e.beta : 0;
      const gamma = e.gamma !== null ? e.gamma : 0;

      // Center calibration calculations
      const calibratedAlpha = (alpha - calibrationAngle + 360) % 360;

      setRotation({ alpha: calibratedAlpha, beta, gamma });

      // 1. Update 3D Audio Listener Head Orientation
      // Standardize Yaw angle (radians)
      const yawRad = (calibratedAlpha * Math.PI) / 180;
      
      // Calculate 3D direction vector representing direction looking straight out
      // Looking forward maps down -Z axis by default
      const forwardX = Math.sin(yawRad);
      const forwardY = 0; // maintain horizontal ear tracking flat
      const forwardZ = -Math.cos(yawRad);

      const ctx = audioCtxRef.current;
      if (ctx && ctx.listener) {
        if (ctx.listener.forwardX) {
          const t = ctx.currentTime;
          ctx.listener.forwardX.setTargetAtTime(forwardX, t, 0.04);
          ctx.listener.forwardY.setTargetAtTime(forwardY, t, 0.04);
          ctx.listener.forwardZ.setTargetAtTime(forwardZ, t, 0.04);
          ctx.listener.upX.setTargetAtTime(0, t, 0.04);
          ctx.listener.upY.setTargetAtTime(1, t, 0.04);
          ctx.listener.upZ.setTargetAtTime(0, t, 0.04);
        } else {
          // Legacy Web Audio fallback
          ctx.listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
        }
      }

      // 2. Transmit coordinates over socket back to Desktop Mixer
      socketRef.current?.emit("device-motion", {
        roomId,
        rotation: { alpha: calibratedAlpha, beta, gamma },
      });
    };

    const requestPermission = (DeviceOrientationEvent as any).requestPermission;
    if (typeof requestPermission === "function") {
      // iOS 13+ devices require explicit sensor request trigger
      requestPermission()
        .then((state: string) => {
          if (state === "granted") {
            setSensorPermission("granted");
            window.addEventListener("deviceorientation", handleOrientation);
          } else {
            setSensorPermission("denied");
          }
        })
        .catch((err: any) => {
          console.error("Sensor request failed:", err);
          setSensorPermission("denied");
        });
    } else {
      // Android / Chrome / Desktop standard
      setSensorPermission("granted");
      window.addEventListener("deviceorientation", handleOrientation);
    }
  };

  // Reset/Calibrate Orientation yaw offset
  const handleCalibrate = () => {
    // Uncalibrated raw alpha acts as the center baseline offset
    setCalibrationAngle(rotation.alpha);
  };

  return (
    <div className="min-h-screen bg-bento-bg text-bento-text flex flex-col font-sans px-6 py-8 justify-between selection:bg-bento-accent selection:text-bento-bg">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-bento-border pb-4 mb-6">
        <div className="flex items-center gap-2.5">
          <Smartphone className="w-5 h-5 text-bento-accent" />
          <div className="text-left">
            <h1 className="font-bold text-sm tracking-tight text-bento-text">MOBILE SPATIAL PLAYER</h1>
            <p className="text-[10px] text-bento-muted font-mono uppercase tracking-wider">Headphone spatializing engine</p>
          </div>
        </div>

        {/* Network Status indicator badge */}
        <div className="flex items-center gap-1.5 bg-bento-card border border-bento-border p-1.5 px-3 rounded-lg text-xs font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-bento-accent bento-glow-accent" : "bg-red-500"}`} />
          <span className="text-[10px] text-bento-accent font-bold">{roomId || "CONNECTING..."}</span>
        </div>
      </div>

      {/* Main Core interactive Area */}
      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto w-full gap-8">
        {!audioContextActive ? (
          /* Activate Button View */
          <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-bento-accent/20 rounded-full blur-2xl animate-pulse" />
              <button
                onClick={startAudioEngine}
                className="relative w-36 h-36 bg-bento-accent hover:opacity-95 text-bento-bg rounded-full flex flex-col items-center justify-center shadow-2xl shadow-bento-accent/15 transition-all hover:scale-105 border-4 border-bento-border cursor-pointer"
              >
                <Radio className="w-12 h-12 mb-1 text-bento-bg animate-bounce" />
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-bento-bg">
                  ACTIVATE ENGINE
                </span>
              </button>
            </div>
            <h3 className="font-bold text-base text-bento-text mb-2">Initialize Web Audio Context</h3>
            <p className="text-xs text-bento-muted leading-relaxed">
              Touch the launcher icon above to authorize audio outputs and initialize HRTF 3D spatial panners. Wear stereo headphones for maximum immersion!
            </p>
          </div>
        ) : (
          /* Head Tracking / Rotation Status Dashboard */
          <div className="w-full flex flex-col items-center gap-6 animate-in fade-in duration-200">
            {/* Visual Compass */}
            <div className="relative w-44 h-44 border-4 border-bento-border rounded-full bg-bento-card flex items-center justify-center shadow-inner">
              <div
                className="absolute w-36 h-36 border-2 border-dashed border-bento-accent/30 rounded-full transition-transform duration-100"
                style={{ transform: `rotate(${-rotation.alpha}deg)` }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1.5 w-3 h-3 bg-bento-accent rounded-full shadow-lg" />
              </div>
              <div className="flex flex-col items-center z-10">
                <Compass className="w-10 h-10 text-bento-accent mb-1" />
                <span className="text-xs font-mono font-bold text-bento-text">
                  {Math.round(rotation.alpha)}°
                </span>
                <span className="text-[9px] font-mono font-bold text-bento-muted uppercase tracking-widest mt-0.5">
                  HEADING YAW
                </span>
              </div>
            </div>

            {/* Calibration trigger and guidelines */}
            <div className="flex flex-col gap-3 w-full">
              <div className="flex gap-2.5 items-center justify-center text-xs bg-bento-card border border-bento-border p-3 rounded-xl">
                <AudioLines className="w-4 h-4 text-bento-accent animate-pulse" />
                <span className="font-semibold text-bento-text/90">
                  Audio Engine: <span className="text-bento-accent uppercase font-bold">Rendering 3D</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full">
                <button
                  onClick={handleCalibrate}
                  className="flex items-center justify-center gap-2 bg-bento-card hover:bg-bento-muted border border-bento-border px-4 py-2.5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all text-bento-text cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-bento-accent" />
                  <span>Calibrate</span>
                </button>

                <div className="flex items-center justify-center gap-1.5 bg-bento-bg border border-bento-border p-2.5 rounded-xl">
                  <Smartphone className="w-3.5 h-3.5 text-bento-muted" />
                  <div className="text-left leading-none">
                    <p className="text-[9px] font-mono text-bento-muted uppercase">Master Vol</p>
                    <p className="text-[11px] font-mono font-bold text-bento-accent mt-0.5">
                      {Math.round(masterVolume * 100)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Warning Permission Alerts */}
        {audioContextActive && sensorPermission !== "granted" && (
          <div className="flex items-start gap-2.5 bg-rose-950/20 border border-rose-900/30 p-3.5 rounded-xl text-left">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-rose-300">Sensor Permission Required</p>
              <p className="text-[10px] text-rose-400/80 leading-relaxed mt-1">
                Your device orientation sensor is restricted. Real-time ear rotation and headset positioning won't follow your head movements until granted.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Area */}
      <footer className="text-center text-[10px] text-bento-muted border-t border-bento-border pt-5 mt-6">
        <p className="font-semibold uppercase tracking-widest text-[9px] text-bento-text">3D Spatial Mixer Web Client v3.0</p>
        <p className="mt-1 leading-relaxed">
          Secure, direct link active. Minimize phone screen tilt and sit in alignment with your desktop.
        </p>
      </footer>
    </div>
  );
}
