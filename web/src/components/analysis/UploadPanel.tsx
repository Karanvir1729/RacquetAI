import { Film, FolderOpen, ShieldCheck, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { checkHealth, defaultApiBase, writeApiBase } from "@/analysis/client";
import { formatBytes } from "@/analysis/format";
import { Button } from "@/components/ui/Button";
import { Card, Hairline, IconChip } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

/**
 * Step one: hand over a video.
 *
 * Drag-and-drop AND a file button, because on a phone there is nothing to drag
 * — the dashed area is itself the button there, at well over the 44px minimum.
 * The extension check mirrors the server's (`ALLOWED_EXT = {.mp4, .mov}`) so a
 * file that cannot possibly work is refused here instead of after a
 * ten-minute upload.
 *
 * The server address is exposed rather than hidden. This site does not host an
 * analysis server; it talks to one you run (`analysis/server.py`, port 8082 by
 * default). Pretending otherwise would produce a beautiful page that silently
 * fails, so the address, its reachability and how to start it are all on the
 * surface.
 */

const ACCEPT = ".mp4,.mov,video/mp4,video/quicktime";
/** Ties the rejection message to the file input while one is showing. */
const REJECTED_ID = "rq-upload-rejected";

function isSupported(file: File): boolean {
  return /\.(mp4|mov)$/i.test(file.name);
}

interface UploadPanelProps {
  apiBase: string;
  onApiBaseChange: (base: string) => void;
  onStart: (file: File) => void;
}

export function UploadPanel({ apiBase, onApiBaseChange, onStart }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const take = useCallback((incoming: File | undefined) => {
    if (incoming === undefined) return;
    if (!isSupported(incoming)) {
      setRejected(`${incoming.name} isn't an .mp4 or .mov — those are the two formats the analysis server accepts.`);
      setFile(null);
      return;
    }
    setRejected(null);
    setFile(incoming);
  }, []);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files[0]);
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <p className="rq-eyebrow">Step 1 · Upload</p>
        <h2 className="rq-h3 mt-2">Give it a match to look at</h2>
        <p className="rq-lead-sm mt-3">
          One camera, fixed, behind or above the court, with both players and the floor in shot.
          .mp4 or .mov. The server downscales to 854px wide before anything else, so a phone
          recording is fine.
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {/* The whole zone opens the picker, as its own mobile copy promises. No
            `role="button"` or tabIndex though: this div CONTAINS the real
            <button> and the <input>, so making it a button too would nest
            interactive controls, add a second tab stop and give the picker an
            accessible name the length of the panel. The inner button is the
            keyboard and screen-reader path. Both children stop the click from
            bubbling, because `input.click()` bubbles too — without that this
            handler would re-enter itself. */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "cursor-pointer rounded-rq-md border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-10",
          )}
          style={{
            borderColor: over ? "var(--rq-accent)" : "var(--rq-line-2)",
            background: over ? "var(--rq-accent-soft)" : "var(--rq-card)",
          }}
        >
          <div className="flex justify-center">
            <IconChip>
              <UploadCloud className="h-5 w-5" />
            </IconChip>
          </div>
          <p className="mt-4 text-[16px] font-extrabold">
            <span className="hidden sm:inline">Drop a match video here, or </span>
            <span className="sm:hidden">Choose a match video</span>
          </p>
          <p className="rq-caption mt-1.5">Up to 4 GB · .mp4 or .mov · sent only to the server below</p>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-describedby={rejected === null ? undefined : REJECTED_ID}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              take(event.target.files?.[0]);
              // Let the same file be re-picked after a cancelled run.
              event.target.value = "";
            }}
          />
          <div className="mt-5 flex justify-center">
            <Button
              size="md"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              <FolderOpen className="h-4 w-4" /> Choose a file
            </Button>
          </div>
        </div>

        {rejected !== null ? (
          <p
            id={REJECTED_ID}
            role="alert"
            className="mt-4 rounded-rq-sm border px-3 py-2.5 text-[13px] font-semibold"
            style={{
              borderColor: "var(--rq-danger)",
              background: "var(--rq-danger-soft)",
              color: "var(--rq-danger)",
            }}
          >
            {rejected}
          </p>
        ) : null}

        {file !== null ? (
          <div
            className="mt-4 flex flex-wrap items-center gap-3 rounded-rq-sm border px-4 py-3"
            style={{ borderColor: "var(--rq-line)", background: "var(--rq-card-raised)" }}
          >
            <span style={{ color: "var(--rq-accent-text)" }}>
              <Film className="h-5 w-5" />
            </span>
            <div className="min-w-0 grow">
              <p className="truncate text-[14px] font-bold">{file.name}</p>
              <p className="rq-num text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
                {formatBytes(file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Remove this file"
              className="inline-flex h-11 w-11 items-center justify-center rounded-rq-sm border"
              style={{ borderColor: "var(--rq-line)", color: "var(--rq-text-dim)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="mt-5">
          <Button size="lg" disabled={file === null} onClick={() => file !== null && onStart(file)}>
            Upload and analyze
          </Button>
        </div>
      </div>

      <Hairline />
      <ServerSettings apiBase={apiBase} onChange={onApiBaseChange} />
    </Card>
  );
}

/**
 * Where the video is sent. Collapsed by default — most people running this
 * locally never touch it — but never hidden, because "my video went somewhere"
 * is not a question a site should leave unanswered.
 */
function ServerSettings({
  apiBase,
  onChange,
}: {
  apiBase: string;
  onChange: (base: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(apiBase);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => setValue(apiBase), [apiBase]);

  useEffect(() => {
    const controller = new AbortController();
    setReachable(null);
    let cancelled = false;
    void checkHealth(apiBase, controller.signal).then((ok) => {
      if (!cancelled) setReachable(ok);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase]);

  const apply = () => {
    const next = value.trim();
    writeApiBase(next);
    onChange(next.length === 0 ? defaultApiBase() : next);
  };

  return (
    <div className="px-5 py-4 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2.5 text-left"
      >
        <span style={{ color: "var(--rq-accent-text)" }}>
          <ShieldCheck className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-bold">Analysis server</span>
        <span
          className="inline-flex items-center gap-1.5 rounded-rq-pill px-2 py-0.5 text-[11px] font-bold"
          style={{
            background: "var(--rq-card-raised)",
            color: reachable === true ? "var(--rq-accent-text)" : "var(--rq-text-dim)",
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              // The pip is the only genuinely pending thing here — the word
              // beside it is a status the user has to be able to read.
              background:
                reachable === null
                  ? "var(--rq-text-faint)"
                  : reachable
                    ? "var(--rq-data)"
                    : "var(--rq-danger)",
            }}
          />
          {reachable === null ? "checking" : reachable ? "reachable" : "not reachable"}
        </span>
        <span className="ml-auto text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
          {open ? "Hide" : "Change"}
        </span>
      </button>

      {open ? (
        <div className="mt-3">
          <label className="rq-caption" htmlFor="rq-api-base">
            Base URL of your <code>analysis/server.py</code>. Leave as <code>/api</code> when running
            the dev server, which proxies to <code>localhost:8082</code>.
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="rq-api-base"
              type="url"
              inputMode="url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="http://localhost:8082"
              className="min-h-[44px] grow rounded-rq-sm border px-3 text-[14px]"
              style={{
                borderColor: "var(--rq-line-2)",
                background: "var(--rq-input)",
                color: "var(--rq-text)",
                minWidth: "min(100%, 16rem)",
              }}
            />
            <Button size="sm" variant="outline" onClick={apply}>
              Use this server
            </Button>
          </div>
          <p className="rq-caption mt-2">
            Start it with <code>analysis/.venv/bin/python analysis/server.py</code>. Videos are
            uploaded there and nowhere else — this site has no backend of its own.
          </p>
        </div>
      ) : null}
    </div>
  );
}
