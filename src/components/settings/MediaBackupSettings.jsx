import React, { useEffect, useRef, useState } from "react";
import { Loader2, Files, Film, Upload, FileJson } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listMedia, formatBytes } from "@/lib/mediaStore";
import {
  MB, PART_SIZE_CHOICES_MB, DEFAULT_PART_SIZE_MB, savePart,
  exportAllFilesZipParts, restoreFromZipFiles,
} from "@/lib/mediaBackup";
import { exportImagesInParts } from "@/components/settings/DataBackupRestore";

// Settings → Export → "Large media backups (split into parts)".
// Pictures, videos and attached files are big, so they're backed up in parts of
// a size you choose. Each part is a standalone file; restoring a part only adds
// or updates — it never deletes anything.
export default function MediaBackupSettings() {
  const [partMB, setPartMB] = useState(() => {
    try { return Number(localStorage.getItem("symphony_backup_part_mb_v1")) || DEFAULT_PART_SIZE_MB; } catch { return DEFAULT_PART_SIZE_MB; }
  });
  const [busy, setBusy] = useState(null);       // null | "json" | "imgzip" | "files" | "restore"
  const [progress, setProgress] = useState("");
  const [stats, setStats] = useState(null);     // { count, bytes }
  const fileRef = useRef(null);

  const refreshStats = async () => {
    try {
      const list = await listMedia();
      setStats({ count: list.length, bytes: list.reduce((n, m) => n + (m.size || 0), 0) });
    } catch { setStats(null); }
  };
  useEffect(() => { refreshStats(); }, []);

  const changeSize = (mb) => {
    setPartMB(mb);
    try { localStorage.setItem("symphony_backup_part_mb_v1", String(mb)); } catch { /* noop */ }
  };

  const run = async (kind, fn, noun) => {
    setBusy(kind);
    setProgress("");
    try {
      const r = await fn();
      if (!r.items) toast.info(`No ${noun} to back up yet.`);
      else if (r.cancelled) toast.info(`Stopped after ${r.parts} of ${r.total} part${r.total === 1 ? "" : "s"}.`);
      else toast.success(`Saved ${r.parts} part${r.parts === 1 ? "" : "s"}${r.location ? ` to ${r.location}` : ""}. Restoring a part only adds or updates.`);
    } catch (e) {
      toast.error(e?.message || "Backup failed");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const onProgress = ({ part, total }) => setProgress(`Part ${part} of ${total}…`);
  const maxBytes = partMB * MB;

  const restore = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy("restore");
    try {
      const t = await restoreFromZipFiles(files, ({ index, total, name }) => setProgress(`${index} of ${total}: ${name}`));
      await refreshStats();
      const bits = [];
      if (t.images) bits.push(`${t.images} picture${t.images === 1 ? "" : "s"}`);
      if (t.files) bits.push(`${t.files} file${t.files === 1 ? "" : "s"}`);
      if (bits.length) toast.success(`Restored ${bits.join(" and ")}.${t.failed ? ` ${t.failed} couldn't be read.` : ""}`);
      else toast.error(t.failed ? "Couldn't read that zip." : "Nothing to restore in that file.");
    } catch (err) {
      toast.error(err?.message || "Restore failed");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const disabled = !!busy;
  const spin = (k) => (busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Files — pictures, audio, videos and attachments — are heavy, so back them up in parts. Each part is its own file, with every file's real name and type, and restoring a part only adds or updates — nothing is deleted.
        {stats && stats.count > 0 && <> You have <span className="font-medium text-foreground">{stats.count}</span> attached file{stats.count === 1 ? "" : "s"} ({formatBytes(stats.bytes)}).</>}
      </p>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor="part-size" className="text-sm">Maximum size per part</label>
        <select
          id="part-size"
          value={partMB}
          onChange={(e) => changeSize(Number(e.target.value))}
          disabled={disabled}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          {PART_SIZE_CHOICES_MB.map((mb) => <option key={mb} value={mb}>{mb} MB</option>)}
        </select>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground -mt-1">
        On Android, parts up to about 40 MB are saved straight to Downloads/Oceans Symphony. Bigger parts open the share sheet so you choose where they go. A single file larger than the limit gets a part of its own.
      </p>

      <div className="grid gap-2">
        <Button variant="outline" size="sm" disabled={disabled} className="justify-start gap-2"
          onClick={() => run("files", () => exportAllFilesZipParts({ maxBytes, onProgress }), "files")}>
          {spin("files") || <Files className="w-4 h-4" />} All files → .zip parts
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} className="justify-start gap-2"
          onClick={() => run("videos", () => exportAllFilesZipParts({ maxBytes, onProgress, pictures: false }), "videos or attachments")}>
          {spin("videos") || <Film className="w-4 h-4" />} Videos &amp; attachments only → .zip parts
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} className="justify-start gap-2"
          onClick={() => run("json", () => exportImagesInParts({ maxBytes, savePart, onProgress }), "files")}>
          {spin("json") || <FileJson className="w-4 h-4" />} Files backup (.json) parts — pictures &amp; audio
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} className="justify-start gap-2" onClick={() => fileRef.current?.click()}>
          {spin("restore") || <Upload className="w-4 h-4" />} Restore from .zip parts…
        </Button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={restore} />
      </div>

      {progress && <p className="text-xs text-muted-foreground tabular-nums">{progress}</p>}
      <p className="text-[0.6875rem] text-muted-foreground">
        The .json parts restore with the normal <span className="font-medium">Import</span> button (add / update mode). They hold pictures and audio only — videos and attachments are in the .zip parts. The .zip parts restore with the button above, and you can pick several at once.
      </p>
    </div>
  );
}
