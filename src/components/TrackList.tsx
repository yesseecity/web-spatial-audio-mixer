import React, { useState, useRef } from "react";
import { Track } from "../types";
import {
  Waves,
  Disc,
  Activity,
  Mic,
  Volume2,
  VolumeX,
  Play,
  Pause,
  UploadCloud,
  Trash2,
  Sliders,
  Music
} from "lucide-react";

interface TrackListProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrackVolume: (id: string, vol: number) => void;
  onToggleTrackPlaying: (id: string) => void;
  onAddCustomTrack: (name: string, base64Data: string) => void;
  onDeleteTrack: (id: string) => void;
}

export default function TrackList({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onUpdateTrackVolume,
  onToggleTrackPlaying,
  onAddCustomTrack,
  onDeleteTrack,
}: TrackListProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to get matching icons
  const getIcon = (iconName: string, color: string, active: boolean) => {
    const props = {
      className: `w-4 h-4 shrink-0 transition-transform ${active ? "scale-110" : ""}`,
      style: { color: active ? color : "#94a3b8" },
    };

    switch (iconName) {
      case "Waves":
        return <Waves {...props} />;
      case "Disc":
        return <Disc {...props} />;
      case "Activity":
        return <Activity {...props} />;
      case "Mic":
        return <Mic {...props} />;
      default:
        return <Music {...props} />;
    }
  };

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Process selected file
  const processFile = (file: File) => {
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      setUploadError("Unsupported file type. Please select an audio file (MP3, WAV, etc.).");
      return;
    }

    // Limit to 10MB to avoid oversized base64 socket payloads
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File is too large. Please select an audio file under 10MB.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result as string;
        // Strip data prefix (e.g. "data:audio/mp3;base64,") before adding
        onAddCustomTrack(file.name.replace(/\.[^/.]+$/, ""), result);
        setIsUploading(false);
        setDragActive(false);
      } catch (err) {
        console.error("FileReader failed:", err);
        setUploadError("Failed to parse the audio file. Please try again.");
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setUploadError("Error reading file.");
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Active Tracks Panel */}
      <div className="bg-bento-card border border-bento-border rounded-2xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-4 border-b border-bento-border pb-3">
          <Sliders className="w-4 h-4 text-bento-accent" />
          <h3 className="font-semibold text-sm uppercase tracking-wider text-bento-text">
            Audio Channels
          </h3>
          <span className="ml-auto bg-bento-bg text-bento-accent text-[10px] font-mono px-2 py-0.5 rounded-full border border-bento-border/50">
            {tracks.length} active
          </span>
        </div>

        <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
          {tracks.map((track) => {
            const isSelected = track.id === selectedTrackId;
            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={`flex flex-col p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-bento-border/20 border-bento-accent/80 shadow-md shadow-bento-accent/5"
                    : "bg-bento-bg/40 border-bento-border/60 hover:bg-bento-border/10 hover:border-bento-muted"
                }`}
              >
                {/* Channel Header Info */}
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: track.color }}
                  />
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {getIcon(track.icon, track.color, track.playing)}
                    <span className="font-semibold text-sm text-bento-text truncate">
                      {track.name}
                    </span>
                  </div>

                  {/* Badges */}
                  <span className="text-[9px] px-1.5 py-0.5 font-semibold uppercase tracking-wider rounded-md bg-bento-bg border border-bento-border/50 text-bento-muted shrink-0">
                    {track.type === "synth" ? "Synth" : "Wave File"}
                  </span>

                  {/* Play/Pause Channel Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTrackPlaying(track.id);
                    }}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                      track.playing
                        ? "text-bento-accent bg-bento-accent/10 hover:bg-bento-accent/20 border border-bento-accent/20"
                        : "text-bento-muted hover:text-bento-text bg-bento-bg border border-bento-border/40 hover:bg-bento-border/40"
                    }`}
                  >
                    {track.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>

                  {/* Delete Track (only files) */}
                  {track.type === "file" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTrack(track.id);
                        if (selectedTrackId === track.id) onSelectTrack(null);
                      }}
                      className="p-1.5 text-bento-muted hover:text-rose-400 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/30 rounded-lg transition-all shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Expanded Controls for Volume / Position display */}
                <div className="mt-3 flex items-center gap-3">
                  {/* Volume Slider */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {track.volume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 text-bento-muted shrink-0" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-bento-text shrink-0" />
                    )}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={track.volume}
                      onClick={(e) => e.stopPropagation()} // block node selection click
                      onChange={(e) => {
                        e.stopPropagation();
                        onUpdateTrackVolume(track.id, parseFloat(e.target.value));
                      }}
                      className="w-full h-1 bg-bento-bg rounded-lg appearance-none cursor-pointer accent-bento-accent focus:outline-none"
                    />
                    <span className="text-[10px] font-mono text-bento-muted w-8 text-right shrink-0">
                      {Math.round(track.volume * 100)}%
                    </span>
                  </div>

                  {/* Coordinate Coordinates */}
                  <div className="text-[10px] font-mono text-bento-accent bg-bento-bg/80 px-2 py-0.5 rounded-md border border-bento-border/50 shrink-0">
                    X:{track.x.toFixed(1)} Y:{track.y.toFixed(1)} Z:{track.z.toFixed(1)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upload Custom Audio Section */}
      <div
        className={`bg-bento-card border rounded-2xl p-5 shadow-xl transition-all ${
          dragActive
            ? "border-bento-accent bg-bento-accent/5"
            : "border-bento-border hover:border-bento-muted"
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center border border-dashed border-bento-border rounded-xl p-5 text-center bg-bento-bg/30">
          <UploadCloud className="w-8 h-8 text-bento-accent mb-2.5 animate-pulse" />
          <p className="text-xs font-semibold text-bento-text mb-1">
            Spatializer Custom Track Upload
          </p>
          <p className="text-[10px] text-bento-muted mb-4 max-w-[220px] leading-relaxed">
            Drag and drop any MP3 / WAV audio, or click to upload. Files are sent directly to the mobile speaker device in real-time.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleChange}
            className="hidden"
          />

          <button
            onClick={triggerFileInput}
            disabled={isUploading}
            className="px-5 py-2 text-xs font-mono font-bold uppercase text-bento-bg bg-bento-accent hover:opacity-90 active:opacity-100 disabled:bg-bento-border disabled:text-bento-muted rounded-xl shadow-lg shadow-bento-accent/10 transition-all cursor-pointer"
          >
            {isUploading ? "Reading file..." : "Browse Audio"}
          </button>

          {uploadError && (
            <p className="mt-3 text-[10px] text-rose-400 font-medium leading-relaxed max-w-[240px]">
              {uploadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
