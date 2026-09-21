export function formatSecondsToTimecode(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const sec = Math.floor(totalSeconds);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(remMinutes)}:${pad(seconds)}`;
  }
  return `${pad(remMinutes)}:${pad(seconds)}`;
}

export function formatFramesToTimecode(frame: number, fps = 30): string {
  if (!Number.isFinite(frame) || frame < 0) return "00:00:00";
  const safeFps = Math.max(1, fps);
  const totalSeconds = frame / safeFps;
  const baseTimecode = formatSecondsToTimecode(totalSeconds);
  const remFrames = Math.floor(frame % safeFps);
  const pad = (n: number) => n.toString().padStart(2, "0");

  return `${baseTimecode}.${pad(remFrames)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
