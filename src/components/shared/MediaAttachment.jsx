import React, { useEffect, useRef, useState } from "react";
import { File as FileIcon, Film, Music, Loader2 } from "lucide-react";
import { getMedia, playableBlob, formatBytes } from "@/lib/mediaStore";

// An attached file inside a message / bulletin / comment: a video or audio
// player with a playback-speed picker, or a file card. Always the ORIGINAL
// bytes — nothing is re-encoded. Rendered from the inert
// <div data-media-id="…"> placeholder (see renderBulletinContent.jsx).

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const rateLabel = (r) => `${r}×`;

export default function MediaAttachment({ id, kind: kindHint, name: nameHint, size: sizeHint }) {
  // undefined = loading, null = not on this device
  const [rec, setRec] = useState(undefined);
  const [url, setUrl] = useState(null);
  const [rate, setRate] = useState(1);
  const mediaRef = useRef(null);

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setRec(undefined);
    setUrl(null);
    (async () => {
      try {
        const r = await getMedia(id);
        if (!alive) return;
        if (!r) { setRec(null); return; }
        const blob = playableBlob(r);
        if (blob && (r.kind === "video" || r.kind === "audio")) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
        setRec(r);
      } catch {
        if (alive) setRec(null);
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);

  // Keep the chosen speed applied — the element resets it when the source loads.
  useEffect(() => {
    const el = mediaRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, url]);

  const kind = rec?.kind || kindHint || "file";
  const name = rec?.name || nameHint || "file";
  const size = rec?.size ?? (Number(sizeHint) || 0);
  const Icon = kind === "video" ? Film : kind === "audio" ? Music : FileIcon;

  if (rec === undefined) {
    return (
      <div className="my-1.5 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading {name}…
      </div>
    );
  }

  if (rec === null) {
    return (
      <div className="my-1.5 inline-flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="min-w-0 break-words">{name}{size ? ` (${formatBytes(size)})` : ""} isn't stored on this device. Restore it from a files backup (Settings → Export → Large media backups).</span>
      </div>
    );
  }

  if ((kind === "video" || kind === "audio") && url) {
    return (
      <div className="my-1.5 w-full max-w-md rounded-xl border border-border/50 bg-muted/20 p-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
        {kind === "video" ? (
          <video
            ref={mediaRef}
            src={url}
            controls
            playsInline
            preload="metadata"
            className="w-full max-h-[60vh] rounded-lg bg-black"
            onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; }}
            onRateChange={(e) => {
              const r = Math.round(e.currentTarget.playbackRate * 100) / 100;
              if (r !== rate) setRate(r);
            }}
          />
        ) : (
          <audio
            ref={mediaRef}
            src={url}
            controls
            preload="metadata"
            className="w-full"
            onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; }}
            onRateChange={(e) => {
              const r = Math.round(e.currentTarget.playbackRate * 100) / 100;
              if (r !== rate) setRate(r);
            }}
          />
        )}

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Playback speed">
          <span className="text-[0.6875rem] text-muted-foreground mr-0.5">Speed</span>
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rate === r}
              onClick={() => setRate(r)}
              className={`px-1.5 py-0.5 rounded text-[0.6875rem] tabular-nums border transition-colors ${rate === r ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/50 text-muted-foreground hover:text-foreground"}`}
            >
              {rateLabel(r)}
            </button>
          ))}
        </div>

        <p className="text-[0.6875rem] text-muted-foreground min-w-0 truncate">{name} · {formatBytes(size)}</p>
      </div>
    );
  }

  // Any other file: a simple card.
  return (
    <div className="my-1.5 inline-flex max-w-full items-center gap-2.5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <Icon className="w-5 h-5 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-[0.6875rem] text-muted-foreground">{formatBytes(size)} · original file</p>
      </div>
    </div>
  );
}
