/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Track {
  id: string;
  name: string;
  x: number; // Left/Right (-5.0 to +5.0)
  y: number; // Up/Down (-5.0 to +5.0)
  z: number; // Forward/Backward (-5.0 to +5.0)
  volume: number; // 0.0 to 1.0
  playing: boolean;
  color: string;
  icon: string;
  type: "synth" | "file";
  synthType?: "pad" | "lead" | "beat" | "drone";
  fileData?: string; // Base64 encoded audio file data
  fileName?: string;
}

export interface RoomState {
  roomId: string;
  tracks: Track[];
  playing: boolean;
  masterVolume: number;
  listenerPosition: [number, number, number];
  listenerOrientation: [number, number, number, number, number, number]; // forwardX, forwardY, forwardZ, upX, upY, upZ
}

export interface DeviceRotation {
  alpha: number; // Yaw (0 to 360)
  beta: number;  // Pitch (-180 to 180)
  gamma: number; // Roll (-90 to 90)
}
