// Karya Go — microphone capture. MediaRecorder works in iOS home-screen apps; SpeechRecognition does not.
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_SECONDS = 30;

type Status = "idle" | "recording";

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"])
    if (MediaRecorder.isTypeSupported(type)) return type;
  return "";
}

export const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/** Tap start, tap stop. `level` (0..1) drives the ring; onDone gets the clip, or nothing if it was too short. */
export function useRecorder(onDone: (clip: Blob | null) => void) {
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const parts = useRef<{
    recorder?: MediaRecorder;
    stream?: MediaStream;
    audio?: AudioContext;
    frame?: number;
    timer?: number;
    started?: number;
    cancelled?: boolean;
  }>({});
  const done = useRef(onDone);
  done.current = onDone;

  const cleanup = useCallback(() => {
    const p = parts.current;
    if (p.frame) cancelAnimationFrame(p.frame);
    if (p.timer) clearInterval(p.timer);
    p.stream?.getTracks().forEach((t) => t.stop());
    p.audio?.close().catch(() => undefined);
    parts.current = {};
    setLevel(0);
    setSeconds(0);
    setStatus("idle");
  }, []);

  const stop = useCallback((cancel = false) => {
    const p = parts.current;
    if (!p.recorder) return;
    p.cancelled = cancel;
    if (p.recorder.state !== "inactive") p.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!canRecord()) {
      setError("This browser can't record audio. Type the ticket instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      setError("Microphone is blocked. Allow it for Karya in your browser settings, or type instead.");
      return;
    }
    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const p = parts.current;
      const long = Date.now() - (p.started ?? Date.now()) > 700;
      const cancelled = p.cancelled;
      cleanup();
      if (cancelled) return;
      done.current(long && chunks.length ? new Blob(chunks, { type: recorder.mimeType || mimeType }) : null);
    };

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 4));
      parts.current.frame = requestAnimationFrame(tick);
    };

    parts.current = { recorder, stream, audio, started: Date.now() };
    parts.current.timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - (parts.current.started ?? Date.now())) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
    recorder.start(250);
    tick();
    setStatus("recording");
    navigator.vibrate?.(15);
  }, [cleanup, stop]);

  useEffect(() => () => stop(true), [stop]);

  return { status, seconds, level, error, setError, start, stop: () => stop(false), cancel: () => stop(true) };
}
