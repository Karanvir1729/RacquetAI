import { AlertTriangle, ArrowLeft, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { formatBytes } from "@/analysis/format";
import { useJobVideo } from "@/analysis/useJobVideo";
import { saveToHistory } from "@/analysis/history";
import { takePendingUpload } from "@/record/pendingUpload";
import { useJobFlow, type FlowStage } from "@/analysis/useJobFlow";
import { CornerPicker } from "@/components/analysis/CornerPicker";
import { ProgressPanel, StepRail } from "@/components/analysis/FlowProgress";
import { ResultsView } from "@/components/analysis/ResultsView";
import { UploadPanel } from "@/components/analysis/UploadPanel";
import { CoachFeedbackPanel } from "@/components/analysis/CoachFeedbackPanel";
import { VideoRefereePanel } from "@/components/analysis/VideoRefereePanel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { isoDay } from "@/players/shape";

/**
 * The whole journey on one route: upload → mark the court → wait → read-out.
 *
 * Two things worth calling out.
 *
 * The job id goes into the URL as `?job=`. An analysis of a full match runs
 * for minutes; phones lock, tabs get restored, thumbs hit refresh. Rejoining a
 * running job is the difference between a lost afternoon and a reload.
 *
 * The video shown at the end is the LOCAL file, played from an object URL —
 * the server never sends the footage back, and it does not need to. The
 * skeleton is drawn from normalized coordinates over whatever rendering of the
 * same frame the browser gives us, so playing the original locally is both
 * faster and more private than a download. Rejoin a job in a fresh tab and
 * there is no local file, so the read-out renders without video and says so.
 */

function stepFor(stage: FlowStage): number {
  switch (stage.kind) {
    case "idle":
    case "uploading":
      return 0;
    case "waiting":
    case "corners":
      return 1;
    case "analyzing":
    case "fetching":
      return 2;
    case "done":
      return 3;
    case "error":
      return 0;
  }
}

export default function Analyze() {
  const flow = useJobFlow();
  const { stage } = flow;
  const [params, setParams] = useSearchParams();
  const [localVideo, setLocalVideo] = useState<{ url: string; name: string } | null>(null);
  const resumedRef = useRef(false);
  const savedRef = useRef<string | null>(null);
  // The library id the read-out was saved under (null when this browser would
  // not store it) — the second handle a player tag can hang off, next to the
  // job id.
  const [historyId, setHistoryId] = useState<string | null>(null);

  useDocumentTitle(stage.kind === "done" ? "Your analysis" : "Analyze a match");

  const jobId = stage.kind === "idle" || stage.kind === "uploading" ? null : stage.jobId;
  const jobParam = params.get("job");

  // Rejoin a job named in the URL, once, on arrival.
  useEffect(() => {
    if (resumedRef.current) return;
    if (jobParam === null || jobParam.length === 0) return;
    if (stage.kind !== "idle") return;
    resumedRef.current = true;
    flow.resume(jobParam);
  }, [flow, jobParam, stage.kind]);

  // ...and keep the URL pointing at whatever job is actually running.
  useEffect(() => {
    if (jobId === null || jobParam === jobId) return;
    setParams({ job: jobId }, { replace: true });
  }, [jobId, jobParam, setParams]);

  // Keep the finished read-out on this browser, so a refresh does not throw
  // away a match that took minutes of CPU to measure. Keyed by job id: the
  // effect re-runs on every render while the flow sits in `done`, and rejoining
  // the same job in a new tab must update the entry rather than stack a copy.
  useEffect(() => {
    if (stage.kind !== "done") return;
    const key = stage.jobId;
    if (savedRef.current === key) return;
    savedRef.current = key;
    setHistoryId(
      saveToHistory(stage.analysis, {
        jobId: stage.jobId,
        title: localVideo?.name ?? "Match analysis",
        now: new Date(),
      }),
    );
  }, [stage, localVideo]);

  const startOver = useCallback(() => {
    setLocalVideo((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
    resumedRef.current = true; // don't re-resume the job we just abandoned
    savedRef.current = null;
    setHistoryId(null);
    setParams({}, { replace: true });
    flow.reset();
  }, [flow, setParams]);

  const start = useCallback(
    (file: File) => {
      setLocalVideo((current) => {
        if (current !== null) URL.revokeObjectURL(current.url);
        return { url: URL.createObjectURL(file), name: file.name };
      });
      flow.start(file);
    },
    [flow],
  );

  useEffect(
    () => () => {
      if (localVideo !== null) URL.revokeObjectURL(localVideo.url);
    },
    [localVideo],
  );

  // Rejoining a job by `?job=` leaves this tab without the file it uploaded,
  // so ask the server for its working copy. Skipped when the local file is here.
  const doneJobId = stage.kind === "done" ? stage.jobId : null;
  const servedVideo = useJobVideo(doneJobId, localVideo !== null);
  // A take handed over from /record starts analysing on arrival — the visitor
  // already pressed "Analyze this match", and the file lives in memory, not
  // anywhere a file dialog could reach. Reading the slot clears it, so a back
  // button does not re-upload the same take.
  useEffect(() => {
    if (resumedRef.current) return;
    if (stage.kind !== "idle") return;
    const handedOver = takePendingUpload();
    if (handedOver === null) return;
    resumedRef.current = true; // and do not then chase a job id in the URL
    start(handedOver);
  }, [stage.kind, start]);



  if (stage.kind === "done") {
    const playable =
      localVideo?.url ?? (servedVideo.kind === "ready" ? servedVideo.url : null);
    const caption =
      localVideo !== null
        ? "Played from your own copy of the file. The overlay is drawn from the analysis, not baked into the video. The read-out is kept under Your matches on this browser."
        : servedVideo.kind === "ready"
          ? "Played from the server's working copy of your upload — this tab rejoined the job by id, so it did not have your original. The overlay is drawn from the analysis, not baked into the video."
          : servedVideo.kind === "loading"
            ? "Fetching the video back from the server…"
            : servedVideo.kind === "tooLarge"
              ? `The server still has this match (${formatBytes(servedVideo.bytes)}) but it is too large to load into the page. Open the read-out in the tab that uploaded it to watch it.`
              : "No video is attached to this analysis — the measurements below still apply. The server keeps an upload for 48 hours, and this one is past that.";
    return (
      <ResultsView
        analysis={stage.analysis}
        videoSrc={playable}
        eyebrow="Your analysis"
        title={localVideo?.name ?? "Match analysis"}
        caption={caption}
        action={{ to: "/analyze", label: "Analyze another" }}
        clipRef={{
          jobId: stage.jobId,
          historyId,
          title: localVideo?.name ?? "Match analysis",
          playedAt: isoDay(new Date()),
        }}
      >
        {/* Refereeing needs the footage — the local file when this tab has it,
            otherwise the copy fetched back from the job. */}
        <CoachFeedbackPanel analysis={stage.analysis} />
        {playable === null ? null : (
          <VideoRefereePanel analysis={stage.analysis} videoSrc={playable} />
        )}
      </ResultsView>
    );
  }

  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StepRail active={stepFor(stage)} />
          <ButtonLink to="/demo" variant="ghost" size="sm">
            <PlayCircle className="h-4 w-4" /> See a finished one
          </ButtonLink>
        </div>

        <div className="mt-8">
          {stage.kind === "idle" ? (
            <UploadPanel apiBase={flow.apiBase} onApiBaseChange={flow.setApiBase} onStart={start} />
          ) : null}

          {stage.kind === "uploading" ? (
            <ProgressPanel
              eyebrow="Step 1 · Upload"
              title="Sending your match to the analysis server"
              detail={`${stage.fileName} · ${formatBytes(stage.fileBytes)}`}
              progress={stage.fraction}
            >
              <div className="mt-6">
                <Button variant="outline" size="md" onClick={startOver}>
                  Cancel upload
                </Button>
              </div>
            </ProgressPanel>
          ) : null}

          {stage.kind === "waiting" ? (
            <ProgressPanel
              eyebrow="Step 2 · Preparing"
              title="Getting a frame for you to mark"
              detail={
                stage.state.message ??
                "Downscaling the video and pulling a reference frame from the middle of the match."
              }
              progress={stage.state.progressPct === null ? null : stage.state.progressPct / 100}
            >
              <JobLine jobId={stage.jobId} onStartOver={startOver} />
            </ProgressPanel>
          ) : null}

          {stage.kind === "corners" ? (
            <CornerPicker
              frameSrc={stage.frameSrc}
              frameError={stage.frameError}
              onRetryFrame={flow.refreshFrame}
              submitting={stage.submitting}
              error={stage.error}
              onSubmit={flow.placeCorners}
            />
          ) : null}

          {stage.kind === "analyzing" ? (
            <ProgressPanel
              eyebrow="Step 3 · Analysis"
              title="Watching the match"
              detail={
                stage.state.message ??
                "Pose estimation runs frame by frame, then shots are placed against the court you marked."
              }
              progress={stage.state.progressPct === null ? null : stage.state.progressPct / 100}
            >
              <p className="rq-caption mt-4">
                Roughly real time on a laptop CPU: a ten-minute match takes about ten minutes. You
                can close this tab — the link in your address bar comes back to this job.
              </p>
              <JobLine jobId={stage.jobId} onStartOver={startOver} />
            </ProgressPanel>
          ) : null}

          {stage.kind === "fetching" ? (
            <ProgressPanel
              eyebrow="Step 3 · Analysis"
              title="Reading the results"
              detail="Downloading the analysis file."
              progress={null}
            />
          ) : null}

          {stage.kind === "error" ? (
            <Card className="p-6 sm:p-8">
              <span style={{ color: "var(--rq-danger)" }}>
                <AlertTriangle className="h-6 w-6" />
              </span>
              <h2 className="rq-h3 mt-4">That didn't work</h2>
              {/* On the message alone — role="alert" on the Card would announce
                  the heading, the job id and both buttons as one utterance. */}
              <p className="rq-lead-sm mt-3" role="alert">
                {stage.message}
              </p>
              {stage.jobId !== null ? (
                <p className="rq-num rq-caption mt-3">Job {stage.jobId}</p>
              ) : null}
              <div className="mt-7 flex flex-wrap gap-3">
                <Button size="md" onClick={startOver}>
                  Start over
                </Button>
                <ButtonLink to="/demo" variant="outline" size="md">
                  See the sample analysis instead
                </ButtonLink>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="mt-8">
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

/** Job id (so it can be quoted in a bug report) plus the escape hatch. */
function JobLine({ jobId, onStartOver }: { jobId: string; onStartOver: () => void }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="rq-num rq-caption">Job {jobId}</p>
      <button
        type="button"
        onClick={onStartOver}
        className="min-h-[44px] text-[13px] font-bold underline underline-offset-4"
        style={{ color: "var(--rq-text-dim)" }}
      >
        Start over
      </button>
    </div>
  );
}
