"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workbenchStyles as s } from "@/components/shared/workbench";
import { clockOf } from "./Recording";
import f from "./family.module.css";

/** A recorder in the page: MediaRecorder, stopped at the API's ten minutes. */
export function Recorder({ max, disabled, onAudio }: { max: number; disabled?: boolean; onAudio: (f: File | null) => void }) {
  const [on, setOn] = useState(false);
  const [sec, setSec] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === "recording") rec.current.stop();
    setOn(false);
  }, []);

  useEffect(() => {
    if (on && sec >= max) stop();
  }, [on, sec, max, stop]);
  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        setUrl(URL.createObjectURL(blob));
        onAudio(new File([blob], `recording.${ext}`, { type: blob.type }));
      };
      rec.current = r;
      r.start(1000);
      onAudio(null);
      setUrl(null);
      setSec(0);
      setOn(true);
      const began = Date.now();
      timer.current = setInterval(() => setSec(Math.floor((Date.now() - began) / 1000)), 250);
    } catch (e) {
      setErr((e as Error).name === "NotAllowedError" ? "The browser wasn’t allowed to use the microphone. Allow it, or upload a recording instead." : `Couldn’t start recording: ${(e as Error).message}`);
    }
  };

  return (
    <div className={f.recorder}>
      <button type="button" className={f.recBtn} data-on={on || undefined} onClick={on ? stop : start} disabled={disabled}>
        {on ? "Stop" : url ? "Record again" : "Start recording"}
      </button>
      <span className={f.recClock} aria-live="off">
        {clockOf(sec)} <small>of {clockOf(max)}</small>
      </span>
      {url && <audio src={url} controls preload="metadata" />}
      {err && <p className={s.error}>{err}</p>}
      {!url && !err && <p className={s.hint} style={{ gridColumn: "1 / -1" }}>Ask about where they were born, their homes, work, family and what they do now. Years and ages help (“in 1966 we moved…”).</p>}
    </div>
  );
}
