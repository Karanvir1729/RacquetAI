import { ComingSoon } from "@/components/ComingSoon";

/**
 * Record tab — placeholder. The real camera capture screen (expo-camera
 * CameraView, portrait match recording, keep-awake while filming) is owned by
 * src/features/recording/ and lands from the feat/video-recording worktree.
 * This file only wires the route; keep it thin when replacing it.
 */
export default function RecordScreen() {
  return (
    <ComingSoon
      title="Record"
      phase="feat/video-recording"
      icon="videocam-outline"
      description="Point your phone at the court and hit record. Match capture lands here — camera preview, recording timer, and save-to-library."
    />
  );
}
