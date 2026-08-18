import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { parseAnalysisValue, type MatchAnalysis } from "@/analysis/types";
import { ProgressPanel } from "@/components/analysis/FlowProgress";
import { ResultsView } from "@/components/analysis/ResultsView";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { SAMPLE_ANALYSIS_URL, SAMPLE_CAPTION, SAMPLE_VIDEO_URL } from "@/data/sampleMatch";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/**
 * The sample analysis — the reason this site is not a dead shell without a
 * server running behind it.
 *
 * It renders the same `ResultsView` a real job ends on, from a real
 * schemaVersion-2 file, over the footage it was computed from. Nothing here is
 * mocked or hand-tuned: if the read-out looks wrong on this page, it is wrong
 * in the product.
 *
 * The fetch goes through `parseAnalysisValue` like any other, so a corrupted
 * copy in `public/` degrades to the message below rather than a white screen.
 */

type Load =
  | { kind: "loading" }
  | { kind: "ready"; analysis: MatchAnalysis }
  | { kind: "failed"; reason: string };

export default function Demo() {
  useDocumentTitle("Sample analysis");
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(SAMPLE_ANALYSIS_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const analysis = parseAnalysisValue(await response.json());
        if (cancelled) return;
        if (analysis === null) {
          setLoad({
            kind: "failed",
            reason: "The bundled sample doesn't match the schema this site can read.",
          });
          return;
        }
        setLoad({ kind: "ready", analysis });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setLoad({
          kind: "failed",
          reason:
            error instanceof Error && error.message.length > 0
              ? `The sample analysis could not be loaded (${error.message}).`
              : "The sample analysis could not be loaded.",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (load.kind === "loading") {
    return (
      <Section divider={false}>
        <div className="mx-auto max-w-2xl">
          <ProgressPanel
            eyebrow="Sample analysis"
            title="Loading the sample match"
            detail="Two megabytes of pose track — it is the real file, not a summary."
            progress={null}
          />
        </div>
      </Section>
    );
  }

  if (load.kind === "failed") {
    return (
      <Section divider={false}>
        <div className="mx-auto max-w-2xl">
          <Card className="p-7 sm:p-9">
            <span style={{ color: "var(--rq-danger)" }}>
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h1 className="rq-h3 mt-4">The sample didn't load</h1>
            <p className="rq-lead mt-3 text-[15px]">{load.reason}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/analyze" size="md">
                Analyze your own match
              </ButtonLink>
              <ButtonLink to="/" variant="outline" size="md">
                Back to the overview
              </ButtonLink>
            </div>
          </Card>
        </div>
      </Section>
    );
  }

  return (
    <ResultsView
      analysis={load.analysis}
      videoSrc={SAMPLE_VIDEO_URL}
      eyebrow="Sample analysis · real output"
      title="7½ minutes of club squash, measured"
      caption={SAMPLE_CAPTION}
      action={{ to: "/analyze", label: "Analyze your own match" }}
    />
  );
}
