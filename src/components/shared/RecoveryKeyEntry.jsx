// "Forgot the password?" — type the recovery key (or pick the recovery file)
// and get the password back via onRecovered(password). The caller then uses
// it exactly as if the person had typed it, so nothing about the lock changes.
import React, { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, FileUp } from "lucide-react";
import { recoverPassword, parseRecoveryFile, RecoveryError } from "@/lib/recovery";

export default function RecoveryKeyEntry({ scope, onRecovered, onCancel, hint, envelope: givenEnvelope = null }) {
  const [key, setKey] = useState("");
  const [envelope, setEnvelope] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const pickFile = async (file) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const parsed = parseRecoveryFile(await file.text());
    if (!parsed || (givenEnvelope === null && ![].concat(scope).includes(parsed.scope))) { setError("That isn't a recovery file for this."); return; }
    setEnvelope(parsed.envelope); setError("");
  };

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setError("");
    try {
      // `scope` may list several (a backup can be locked with either the backup
      // password or the storage password); the first one the key opens wins.
      let pw = null, lastErr = null;
      for (const sc of [].concat(scope)) {
        try { pw = await recoverPassword(sc, key, envelope || givenEnvelope); break; }
        catch (e) { lastErr = e; }
      }
      if (pw === null) throw lastErr || new RecoveryError("That recovery key doesn't match.");
      await onRecovered(pw);
    } catch (e) {
      setError(e instanceof RecoveryError ? e.message : (e?.message || "That didn't work."));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">{hint || "Enter the recovery key you saved when you set this up."}</p>
      <Input
        value={key}
        onChange={(e) => { setKey(e.target.value); setError(""); }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        className="font-mono tracking-wider"
        autoComplete="off" autoCapitalize="characters" spellCheck={false}
      />
      {envelope && <p className="text-xs text-emerald-600 dark:text-emerald-400">Recovery file loaded.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>Back</Button>}
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
          <FileUp className="w-4 h-4" /> Use recovery file
        </Button>
        <Button type="button" size="sm" className="gap-1.5 ml-auto" onClick={submit} disabled={!key.trim() || busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Recover
        </Button>
      </div>
      <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
    </div>
  );
}
