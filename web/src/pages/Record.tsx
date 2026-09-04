import { ArrowLeft, Camera, Download, Square, Upload, Video } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { formatBytes } from "@/analysis/format";
import { handOffForAnalysis } from "@/record/pendingUpload";
import { useRecorder } from "@/record/useRecorder";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/**
 * Filming a match on a laptop.
 *
 * The phone's Record tab, minus the one thing a browser has no answer for: it
 * cannot keep the video. There is no documents folder to save into and no
 * browser will hold a match in storage, so a finished take goes straight to
 * the analyzer, or to the visitor's Downloads folder, or nowhere — and the
 * page says exactly that instead of implying a library it does not have.
 *
 * Recording is genuinely useful here for the setup this product is built
 * around: a camera on a tripod behind the court, wired to a laptop. Anyone
 * filming handheld should use their phone, and the copy points them there.
 */
export default function Record() {
  const recorder = useRecorder();
  const navigate = useNavigate();
  useDocumentTitle("Film a match");

  const { phase, take, stop } = recorder;

  // Leaving the tab mid-take stops the recording rather than filming a ceiling
  // for an hour — the take so far is kept, which is the recoverable outcome.
  useEffect(() => {
    if (phase !== "recording") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [phase, stop]);

  const analyse = useCallback(() => {
    if (take === null) return;
    handOffForAnalysis(take.file);
    navigate("/analyze");
  }, [take, navigate]);

  if (!recorder.supported) {
    return (
      <Shell>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">This browser can't film</h2>
          <p className="rq-lead-sm mt-3">
            Recording needs MediaRecorder, which this browser either lacks or has switched off.
            Film the match on a phone and upload the file — that path works everywhere and is what
            most people use anyway.
          </p>
          <div className="mt-7">
            <ButtonLink to="/analyze" size="md">
              <Upload className="h-4 w-4" /> Upload a video instead
            </ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mt-8">
        <div className="relative overflow-hidden rounded-rq bg-black">
          <video
            ref={recorder.videoRef}
            muted
            playsInline
            className="aspect-video w-full object-cover"
          />
          {phase === "recording" ? (
            <div
              className="absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              <span
                className="h-2.5 w-2.5 animate-pulse rounded-full"
                style={{ background: "var(--rq-danger)" }}
              />
              <span className="rq-num text-[13px] font-bold text-white">
                {formatElapsed(recorder.elapsedSec)}
              </span>
            </div>
          ) : null}
          {phase === "idle" ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button size="md" onClick={() => void recorder.open()}>
                <Camera className="h-4 w-4" /> Turn on the camera
              </Button>
            </div>
          ) : null}
        </div>

        {recorder.error !== null ? (
          <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
            {recorder.error}
          </p>
        ) : null}

        {recorder.cameras.length > 1 && phase !== "recording" ? (
          <label className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rq-label text-rq-dim">Camera</span>
            <select
              value={recorder.deviceId ?? ""}
              onChange={(event) => void recorder.open(event.target.value)}
              className="min-h-[44px] rounded-rq-sm border px-3 text-[14px]"
              style={{
                borderColor: "var(--rq-line)",
                background: "var(--rq-card)",
                color: "var(--rq-text)",
              }}
            >
              {recorder.cameras.map((camera, index) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label.length > 0 ? camera.label : `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {phase === "ready" ? (
            <Button size="md" onClick={recorder.start}>
              <Video className="h-4 w-4" /> Start filming
            </Button>
          ) : null}
          {phase === "recording" ? (
            <Button size="md" onClick={recorder.stop}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : null}
        </div>

        {take !== null ? (
          <Card className="mt-6 p-5 sm:p-6">
            <h2 className="rq-h3">That's {formatElapsed(take.seconds)} in the can</h2>
            <p className="rq-caption rq-num mt-2">
              {take.file.name} · {formatBytes(take.bytes)}
            </p>
            <p className="rq-lead-sm mt-3">
              The file is in this tab's memory and nowhere else. Send it to the analyzer, or save it
              — leaving this page loses it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="md" onClick={analyse}>
                <Upload className="h-4 w-4" /> Analyze this match
              </Button>
              <a
                href={take.url}
                download={take.file.name}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-rq-sm border px-4 text-[14px] font-bold"
                style={{
                  borderColor: "var(--rq-line-2)",
                  background: "var(--rq-card-raised)",
                  color: "var(--rq-text)",
                }}
              >
                <Download className="h-4 w-4" /> Save the video
              </a>
              <Button variant="ghost" size="md" onClick={recorder.discard}>
                Film another
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Film a match</p>
        <h1 className="rq-h2 mt-3">Record from a camera on this machine</h1>
        <p className="rq-lead-sm mt-4">
          Built for the setup the analysis is built around: a camera on a tripod behind the court,
          the whole floor in frame, sound on — the rally boundaries come from the sound of the ball.
          Filming handheld from the balcony is what your phone is for.
        </p>
        {children}
        <div className="mt-8">
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

/** "7:31" — the same clock the read-out uses. */
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
