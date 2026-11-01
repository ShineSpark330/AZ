// Mounted once (AppLayout). Any screen that makes a recovery key but may close
// before it can show it (a journal editor that closes on save) announces it
// with announceRecoveryKey(); this shows the one-time dialog wherever the
// person is.
import React, { useEffect, useState } from "react";
import RecoveryKeyDialog from "@/components/shared/RecoveryKeyDialog";

const EVENT = "symphony-recovery-key";

export function announceRecoveryKey({ recoveryKey, scope, label, blob }) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { recoveryKey, scope, label, blob } }));
}

export default function RecoveryKeyHost() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    const on = (e) => e?.detail?.recoveryKey && setQueue((q) => [...q, e.detail]);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const cur = queue[0];
  return (
    <RecoveryKeyDialog
      open={!!cur} recoveryKey={cur?.recoveryKey} scope={cur?.scope || "recovery"} label={cur?.label || "this"}
      blob={cur?.blob}
      onDone={() => setQueue((q) => q.slice(1))}
    />
  );
}
