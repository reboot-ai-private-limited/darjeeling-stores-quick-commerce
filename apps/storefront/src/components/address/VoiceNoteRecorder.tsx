"use client";

import React, { useState, useRef } from "react";
import { Icon } from "../ui/Icon";

interface VoiceNoteRecorderProps {
  onRecorded: (audioBlob: Blob, durationSec: number) => void;
  onClear: () => void;
}

export const VoiceNoteRecorder: React.FC<VoiceNoteRecorderProps> = ({ onRecorded, onClear }) => {
  const [recording, setRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        onRecorded(audioBlob, 10 - timeLeft);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setRecording(true);
      setTimeLeft(10);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      alert("Microphone access was denied or not supported.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  const clearAudio = () => {
    setAudioUrl(null);
    onClear();
  };

  return (
    <div
      style={{
        background: "var(--cream)",
        borderRadius: 14,
        padding: 14,
        border: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
          Delivery Partner Voice Note (Optional)
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Max 10s</span>
      </div>

      {!audioUrl && !recording && (
        <button
          type="button"
          onClick={startRecording}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 9999,
            background: "var(--card)",
            border: "1.5px solid var(--maroon)",
            color: "var(--maroon)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <Icon name="mic" size={16} />
          <span>Record Voice Directions</span>
        </button>
      )}

      {recording && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--red)",
                animation: "pulse 1s infinite",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--red)" }}>
              Recording... {timeLeft}s remaining
            </span>
          </div>
          <button
            type="button"
            onClick={stopRecording}
            style={{
              padding: "6px 14px",
              borderRadius: 9999,
              background: "var(--red)",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Stop
          </button>
        </div>
      )}

      {audioUrl && !recording && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <audio controls src={audioUrl} style={{ height: 36, flex: 1 }} />
          <button
            type="button"
            onClick={clearAudio}
            style={{ color: "var(--red)", padding: 6 }}
            title="Delete voice note"
          >
            <Icon name="trash-2" size={18} />
          </button>
        </div>
      )}
    </div>
  );
};
