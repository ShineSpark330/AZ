import React, { useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import MediaAttachment from "@/components/shared/MediaAttachment";
import MediaPlayer from "@/components/shared/MediaPlayer";
import MediaTuningPanel from "@/components/shared/MediaTuningPanel";
import { useMediaTuning } from "@/lib/mediaTuning";
import { useResolvedAvatarUrl } from "@/hooks/useResolvedAvatarUrl";

// Plays an audio / video from the Assets library, with the same tempo & pitch
// controls the chat player has. Files attached in chat (media store) reuse the
// chat player itself; songs kept in the picture store play from their own URL.

function StoredAudio({ item }) {
  const url = useResolvedAvatarUrl(item.url);
  const ref = useRef(null);
  const tuning = useMediaTuning(ref, item.key || item.id);
  if (!url) return <p className="text-xs text-muted-foreground">Loading…</p>;
  return (
    <div className="w-full rounded-xl border border-border/50 bg-muted/20 p-2 space-y-1.5">
      <MediaPlayer mediaRef={ref} src={url} kind={item.kind === "video" ? "video" : "audio"} tuning={tuning} />
      <MediaTuningPanel tuning={tuning} />
    </div>
  );
}

export default function MediaViewerDialog({ item, onClose }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined} onClick={(e) => e.stopPropagation()}>
        <DialogTitle className="text-sm truncate pr-8">{item.name}</DialogTitle>
        {item.isMedia
          ? <MediaAttachment id={item.mediaId} kind={item.kind} name={item.name} size={item.size} />
          : <StoredAudio item={item} />}
      </DialogContent>
    </Dialog>
  );
}
