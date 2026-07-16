import React, { useEffect, useRef, useState } from "react";
import { Track } from "../types";
import { Maximize2, Move, HelpCircle } from "lucide-react";

interface SoundFieldVisualizerProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrackPosition: (id: string, x: number, y: number, z: number) => void;
  listenerOrientation: [number, number, number, number, number, number]; // forward(3) + up(3)
  rotationAngle?: number; // yaw angle (degrees) from mobile sensor
}

export default function SoundFieldVisualizer({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onUpdateTrackPosition,
  rotationAngle = 0,
}: SoundFieldVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewMode, setViewMode] = useState<"top" | "front">("top"); // top = X-Z, front = X-Y
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);

  // Soundwave ripple states
  const ripplesRef = useRef<Record<string, number[]>>({});

  // Track size variables (in pixels)
  const NODE_RADIUS = 18;

  // Track positions in canvas pixels
  const getCanvasCoords = (track: Track, width: number, height: number) => {
    const scale = Math.min(width, height) / 12; // -5 to +5 range + margin
    const centerX = width / 2;
    const centerY = height / 2;

    const xPx = centerX + track.x * scale;
    // Top-down: z is up/down on screen. Let's map -z to up, +z to down
    // Front-facing: y is up/down on screen. Let's map +y to up, -y to down
    const yPx =
      viewMode === "top"
        ? centerY + track.z * scale // Web Audio: -Z is in front (up on screen), +Z is behind (down on screen)
        : centerY - track.y * scale; // +Y is up, -Y is down

    return { x: xPx, y: yPx };
  };

  // Convert canvas pixels back to Web Audio coordinates (-5 to 5)
  const getAudioCoords = (clientX: number, clientY: number, width: number, height: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const pxX = clientX - rect.left;
    const pxY = clientY - rect.top;

    const scale = Math.min(width, height) / 12;
    const centerX = width / 2;
    const centerY = height / 2;

    const xVal = Math.min(Math.max((pxX - centerX) / scale, -5), 5);
    const yVal = Math.min(Math.max((centerY - pxY) / scale, -5), 5);

    return { xVal, yVal };
  };

  // Update canvas size on container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const size = Math.max(Math.min(width, height, 600), 280);
        setDimensions({ width: size, height: size });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Frame animation for ripple waves and canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const { width, height } = dimensions;
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const scale = Math.min(width, height) / 12;

      // 1. Draw Space Background grid
      ctx.fillStyle = "#0a0a0c"; // bento-bg
      ctx.fillRect(0, 0, width, height);

      // 2. Draw Concentric Grid Rings
      ctx.strokeStyle = "rgba(45, 46, 53, 0.7)"; // bento-border
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (let r = 1; r <= 5; r++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
        ctx.stroke();

        // Labels
        ctx.fillStyle = "#62626e"; // bento-muted
        ctx.font = "9px monospace";
        ctx.setLineDash([]);
        ctx.fillText(`${r}m`, centerX + r * scale - 12, centerY - 4);
        ctx.setLineDash([4, 4]);
      }

      // 3. Draw Axis lines
      ctx.strokeStyle = "rgba(45, 46, 53, 0.9)"; // bento-border
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(centerX, 20);
      ctx.lineTo(centerX, height - 20);
      ctx.moveTo(20, centerY);
      ctx.lineTo(width - 20, centerY);
      ctx.stroke();

      // Axis Labels
      ctx.fillStyle = "#62626e"; // bento-muted
      ctx.font = "10px monospace";
      if (viewMode === "top") {
        ctx.fillText("-Z (Front)", centerX - 25, 15);
        ctx.fillText("+Z (Rear)", centerX - 23, height - 8);
        ctx.fillText("-X (Left)", 8, centerY - 6);
        ctx.fillText("+X (Right)", width - 60, centerY - 6);
      } else {
        ctx.fillText("+Y (Up)", centerX - 18, 15);
        ctx.fillText("-Y (Down)", centerX - 22, height - 8);
        ctx.fillText("-X (Left)", 8, centerY - 6);
        ctx.fillText("+X (Right)", width - 60, centerY - 6);
      }

      // 4. Update and Draw Sound Ripples (Waves propagating from playing nodes)
      tracks.forEach((track) => {
        if (!track.playing) return;

        // Initialize ripples for track if empty
        if (!ripplesRef.current[track.id]) {
          ripplesRef.current[track.id] = [0.0, 0.33, 0.66];
        }

        const ripples = ripplesRef.current[track.id];
        const coords = getCanvasCoords(track, width, height);

        ripples.forEach((progress, idx) => {
          // Progress goes from 0 to 1
          const nextProgress = progress + 0.008;
          ripples[idx] = nextProgress > 1 ? 0 : nextProgress;

          const radius = NODE_RADIUS + nextProgress * 45 * track.volume;
          const alpha = (1 - nextProgress) * 0.45 * track.volume;

          ctx.beginPath();
          ctx.strokeStyle = `${track.color}${Math.floor(alpha * 255)
            .toString(16)
            .padStart(2, "0")}`;
          ctx.lineWidth = 1.5;
          ctx.arc(coords.x, coords.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        });
      });

      // 5. Draw Listener (Center Head Model)
      ctx.save();
      ctx.translate(centerX, centerY);

      // Rotate listener head based on gyro if top-down view
      if (viewMode === "top") {
        ctx.rotate((rotationAngle * Math.PI) / 180);
      }

      // Draw listener hearing/view cone (wedge)
      const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 50);
      grad.addColorStop(0, "rgba(0, 255, 136, 0.15)"); // bento-accent
      grad.addColorStop(1, "rgba(0, 255, 136, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      // Sweeps 70 degrees arc forward (towards screen top, which is -Z, or angle -Math.PI/2)
      ctx.arc(0, 0, 50, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
      ctx.closePath();
      ctx.fill();

      // Ears (Left and Right)
      ctx.fillStyle = "#00ff88"; // bento-accent
      ctx.beginPath();
      ctx.arc(-15, 0, 5, 0, Math.PI * 2); // left ear
      ctx.arc(15, 0, 5, 0, Math.PI * 2);  // right ear
      ctx.fill();

      // Listener Head Core
      ctx.fillStyle = "#151619"; // bento-card
      ctx.strokeStyle = "#00ff88"; // bento-accent
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Direction Nose / Indicator
      ctx.fillStyle = "#00ff88"; // bento-accent
      ctx.beginPath();
      ctx.moveTo(-4, -10);
      ctx.lineTo(0, -17);
      ctx.lineTo(4, -10);
      ctx.fill();

      ctx.restore();

      // 6. Draw Tracks (Nodes)
      tracks.forEach((track) => {
        const coords = getCanvasCoords(track, width, height);
        const isSelected = track.id === selectedTrackId;

        // Pulse effect for playing tracks
        const pulse = track.playing ? Math.sin(Date.now() * 0.005) * 2 : 0;

        // Shadow/glow for active/selected
        ctx.shadowBlur = isSelected ? 16 : 6;
        ctx.shadowColor = track.color;

        // Node fill
        ctx.fillStyle = track.playing ? track.color : "#2d2e35"; // bento-border
        ctx.strokeStyle = isSelected ? "#ffffff" : track.color;
        ctx.lineWidth = isSelected ? 3 : 2;

        ctx.beginPath();
        ctx.arc(coords.x, coords.y, NODE_RADIUS + pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Reset shadow
        ctx.shadowBlur = 0;

        // Track Icon or Letter
        ctx.fillStyle = track.playing ? "#020617" : "#e0e0e6";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Just print first letter of track name, looks clean
        ctx.fillText(track.name.charAt(0).toUpperCase(), coords.x, coords.y);

        // Track Label Name
        ctx.fillStyle = isSelected ? "#ffffff" : "rgba(224, 224, 230, 0.8)";
        ctx.font = isSelected ? "bold 10px Inter, sans-serif" : "9px Inter, sans-serif";
        ctx.fillText(track.name, coords.x, coords.y + NODE_RADIUS + 13);

        // Short coordinates label (e.g. [1.5, 2.0])
        const coordLabel =
          viewMode === "top"
            ? `${track.x.toFixed(1)}, ${track.z.toFixed(1)}`
            : `${track.x.toFixed(1)}, ${track.y.toFixed(1)}`;
        ctx.fillStyle = "#62626e"; // bento-muted
        ctx.font = "8px monospace";
        ctx.fillText(coordLabel, coords.x, coords.y + NODE_RADIUS + 22);
      });

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [tracks, selectedTrackId, viewMode, dimensions, rotationAngle]);

  // Mouse Handlers for dragging nodes
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if clicked on any track node
    let clickedTrackId: string | null = null;

    for (const track of tracks) {
      const coords = getCanvasCoords(track, dimensions.width, dimensions.height);
      const distance = Math.hypot(mouseX - coords.x, mouseY - coords.y);

      if (distance <= NODE_RADIUS + 10) {
        clickedTrackId = track.id;
        break;
      }
    }

    if (clickedTrackId) {
      onSelectTrack(clickedTrackId);
      setIsDragging(true);
      setDraggedTrackId(clickedTrackId);
    } else {
      onSelectTrack(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !draggedTrackId) return;

    const track = tracks.find((t) => t.id === draggedTrackId);
    if (!track) return;

    const { xVal, yVal } = getAudioCoords(e.clientX, e.clientY, dimensions.width, dimensions.height);

    // If top view: drag adjusts X (left-right) and Z (depth)
    // If front view: drag adjusts X (left-right) and Y (height)
    if (viewMode === "top") {
      // In canvas, y-axis increases downwards. 
      // We mapped -z to up (decreased canvas y) and +z to down (increased canvas y)
      // Therefore, yVal calculated above is positive towards top of screen, negative towards bottom
      // Let's invert yVal back to match Web Audio: top is -Z, bottom is +Z
      onUpdateTrackPosition(track.id, xVal, track.y, -yVal);
    } else {
      // Front view: drag adjusts X and Y (yVal maps directly to height Y)
      onUpdateTrackPosition(track.id, xVal, yVal, track.z);
    }
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
    setDraggedTrackId(null);
  };

  return (
    <div className="flex flex-col items-center w-full" ref={containerRef}>
      {/* Header controls for visualizer */}
      <div className="flex items-center justify-between w-full mb-3 gap-2 px-1">
        <div className="flex items-center gap-1.5 text-bento-text">
          <Move className="w-4 h-4 text-bento-accent" />
          <span className="text-xs font-semibold uppercase tracking-wider text-bento-muted">
            Spatial Field Visualizer
          </span>
        </div>

        {/* Plane View Toggle */}
        <div className="flex bg-bento-bg border border-bento-border p-0.5 rounded-lg shrink-0 text-xs">
          <button
            onClick={() => setViewMode("top")}
            className={`px-3 py-1 font-mono uppercase font-bold text-[10px] rounded-md transition-all cursor-pointer ${
              viewMode === "top"
                ? "bg-bento-accent text-bento-bg shadow-sm"
                : "text-bento-muted hover:text-bento-text"
            }`}
          >
            Top-Down (X-Z)
          </button>
          <button
            onClick={() => setViewMode("front")}
            className={`px-3 py-1 font-mono uppercase font-bold text-[10px] rounded-md transition-all cursor-pointer ${
              viewMode === "front"
                ? "bg-bento-accent text-bento-bg shadow-sm"
                : "text-bento-muted hover:text-bento-text"
            }`}
          >
            Front View (X-Y)
          </button>
        </div>
      </div>

      {/* Actual Canvas */}
      <div className="relative border border-bento-border rounded-2xl overflow-hidden shadow-2xl bg-bento-bg">
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="cursor-crosshair block"
          style={{ width: dimensions.width, height: dimensions.height }}
        />

        {/* Tip overlay */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-bento-card/90 backdrop-blur-md border border-bento-border px-2.5 py-1 rounded-md text-[10px] text-bento-text/80">
          <HelpCircle className="w-3.5 h-3.5 text-bento-accent" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Drag nodes to position sound field</span>
        </div>
      </div>
    </div>
  );
}
