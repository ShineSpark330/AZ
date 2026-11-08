// Shows a freshly made recovery key ONCE. The person must tick that they've
// saved it before the dialog can be closed — the app keeps no copy, so a
// key dismissed by accident is a key lost (they can make another any time).
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyRound, Copy, Download, Check } from "lucide-react";
import { toast } from "sonner";
import { buildRecoveryFile } from "@/lib/recovery";

export default function RecoveryKeyDialog({ open, recoveryKey, scope, label, onDone, blob: givenBlob }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!open || !recoveryKey) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error("Couldn't copy. Write the key down instead."); }
  };
  const download = async () => {
    try {
      const blob = givenBlob || buildRecoveryFile(scope, label, recoveryKey);
      const { shareFile } = await import("@/lib/shareFile");
      const res = await shareFile({ blob, filename: `recovery-key-${scope}.txt`, title: "Recovery key", dialogTitle: "Save recovery key", prefer: "download" });
      if (res?.result === "failed") toast.error("Couldn't save the file. Write the key down instead.");
    } catch { toast.error("Couldn't save the file. Write the key down instead."); }
  };
  const close = () => { setSaved(false); setCopied(false); onDone?.(); };

  return (
    <Dialog open onOpenChange={() => { /* closes only through the button below */ }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Your recovery key</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">For: {label}. If you forget the password, this key gets you back in. It's shown only now.</p>
          <div className="rounded-xl bg-muted/60 border border-border/60 px-3 py-3 text-center font-mono text-base tracking-wider select-all break-all">
            {recoveryKey}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={copy}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={download}>
              <Download className="w-4 h-4" /> Save as file
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep it somewhere safe and separate from this device. Anyone who has it can open what it protects, and nobody (including the app) can get it back for you. The saved file also lets you use it after a browser wipe or on a new device.
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={saved} onCheckedChange={(v) => setSaved(!!v)} className="mt-0.5" />
            <span className="text-sm">I've saved my recovery key somewhere safe.</span>
          </label>
        </div>
        <div className="flex justify-end pt-1">
          <Button onClick={close} disabled={!saved}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
