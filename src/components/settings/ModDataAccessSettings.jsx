// Settings → Storage & encryption → "Mod data access".
//
// Mods can't read the app's records unless the person (1) sets a mod access
// password here, (2) names which role(s) may open the gate (default
// "Gatekeeper"), and (3) grants "data:read" to a specific mod on the Mods page
// with that password while an allowed-role {{alter}} is {{fronting}}. The rules
// live in src/lib/mods/modAccess.js; this is only the screen.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Puzzle, Loader2, KeyRound, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localEntities } from "@/api/base44Client";
import { useTerms } from "@/lib/useTerms";
import { confirm } from "@/components/shared/ConfirmDialog";
import RecoveryKeyDialog from "@/components/shared/RecoveryKeyDialog";
import RecoveryKeyEntry from "@/components/shared/RecoveryKeyEntry";
import { createRecovery, clearRecovery, hasRecovery } from "@/lib/recovery";
import {
  hasModAccessPassword, setModAccessPassword, changeModAccessPassword, verifyModAccessPassword,
  removeModAccessPassword, getAllowedRoles, setAllowedRoles, MIN_PASSWORD_LENGTH, DEFAULT_ROLES,
} from "@/lib/mods/modAccess";

export default function ModDataAccessSettings() {
  const terms = useTerms();
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const has = hasModAccessPassword();
  const roles = getAllowedRoles();

  const [mode, setMode] = useState(null); // set | change | recovery | forgot | null
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [recoveredPw, setRecoveredPw] = useState(null);

  const { data: alters = [] } = useQuery({ queryKey: ["altersForRoles"], queryFn: () => localEntities.Alter.list(), staleTime: 60_000 });
  const knownRoles = useMemo(
    () => [...new Set(alters.map((a) => String(a.role || "").trim()).filter(Boolean))].sort(),
    [alters],
  );

  const reset = () => { setMode(null); setCur(""); setPw(""); setPw2(""); setError(""); setRecoveredPw(null); };
  const fail = (e) => setError(String(e?.message || "Something went wrong.").replace(/\{\{(\w+)\}\}/g, (m, k) => terms[k] || m));

  const checkNew = () => {
    if (pw.length < MIN_PASSWORD_LENGTH) { setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return false; }
    if (pw !== pw2) { setError("Passwords don't match."); return false; }
    return true;
  };
  const issue = async (password) => {
    clearRecovery("mod-access");
    setRecoveryKey(await createRecovery("mod-access", password));
    refresh();
  };

  const doSet = async () => {
    if (!checkNew()) return;
    setBusy(true); setError("");
    try {
      await setModAccessPassword(pw);
      const p = pw; reset(); setOk("Mod access password set."); await issue(p);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const doChange = async () => {
    if (!checkNew()) return;
    setBusy(true); setError("");
    try {
      await changeModAccessPassword(recoveredPw ?? cur, pw);
      const p = pw; reset(); setOk("Mod access password changed."); await issue(p);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const doNewKey = async () => {
    setBusy(true); setError("");
    try {
      if (!(await verifyModAccessPassword(cur))) { setError("That isn't the mod access password."); return; }
      const p = cur; reset(); await issue(p);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const doRemove = async () => {
    const yes = await confirm({
      title: "Turn off mod data access?",
      body: "Every mod loses its ability to read your data right away, and the mod access password and its recovery key are removed. Mods keep their own saved data.",
      confirmLabel: "Turn off", destructive: true,
    });
    if (!yes) return;
    removeModAccessPassword(); clearRecovery("mod-access"); reset(); setOk("Mod data access is off."); refresh();
  };
  const saveRoles = (next) => {
    try { setAllowedRoles(next); refresh(); setError(""); } catch (e) { fail(e); }
  };
  const addRole = () => {
    const r = roleInput.trim();
    if (!r) return;
    saveRoles([...roles, r]); setRoleInput("");
  };

  return (
    <div className="rounded-xl border border-border/50 p-3 space-y-3" data-tour="settings-mod-access">
      <div className="flex items-start gap-2">
        <Puzzle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Mod data access</p>
          <p className="text-xs text-muted-foreground">
            Lets a mod you trust read a copy of your records. It's off for every mod unless you set a password here and then allow it for one mod on the Mods page. Mods can never change your data or send it anywhere.
          </p>
        </div>
      </div>

      {ok && <p className="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg px-2.5 py-1.5">{ok}</p>}
      {error && <p className="text-xs text-destructive bg-destructive/5 rounded-lg px-2.5 py-1.5">{error}</p>}

      {!has && mode !== "set" && (
        <Button variant="outline" size="sm" className="gap-2" onClick={() => { setMode("set"); setOk(""); setError(""); }}>
          <KeyRound className="w-4 h-4" /> Set a mod access password
        </Button>
      )}

      {mode === "set" && !has && (
        <div className="space-y-2">
          <Label className="text-xs">New mod access password</Label>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} autoComplete="new-password" />
          <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm" autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Make it different from your storage password. You'll get a recovery key next.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={reset}>Cancel</Button>
            <Button size="sm" className="flex-1" onClick={doSet} disabled={busy || !pw}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Set password"}</Button>
          </div>
        </div>
      )}

      {has && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Who can allow it</Label>
            <p className="text-xs text-muted-foreground">
              Only while a {terms.alter} with one of these roles is {terms.fronting} can a mod be given access or read anything. Take every role away to turn this check off.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1">
                  {r}
                  <button type="button" aria-label={`Remove ${r}`} onClick={() => saveRoles(roles.filter((x) => x !== r))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {!roles.length && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><ShieldAlert className="w-3.5 h-3.5" /> No role check — the password alone decides.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                list="mod-access-roles" value={roleInput} onChange={(e) => setRoleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRole()} placeholder="Add a role, e.g. Gatekeeper" className="h-8 text-sm"
              />
              <datalist id="mod-access-roles">
                {[...new Set([...DEFAULT_ROLES, ...knownRoles])].filter((r) => !roles.includes(r)).map((r) => <option key={r} value={r} />)}
              </datalist>
              <Button size="sm" variant="outline" onClick={addRole} disabled={!roleInput.trim()}>Add</Button>
            </div>
          </div>

          {!mode && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { setMode("change"); setOk(""); setError(""); }}>Change password</Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setMode("recovery"); setOk(""); setError(""); }}>
                <KeyRound className="w-4 h-4" /> {hasRecovery("mod-access") ? "New recovery key" : "Make a recovery key"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setMode("forgot"); setOk(""); setError(""); }}>Forgot password?</Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={doRemove}>Turn off</Button>
            </div>
          )}

          {mode === "change" && (
            <div className="space-y-2">
              {recoveredPw === null && <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" autoComplete="current-password" />}
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" />
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={reset}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={doChange} disabled={busy || !pw || (recoveredPw === null && !cur)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Change"}</Button>
              </div>
            </div>
          )}

          {mode === "recovery" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">A new key replaces the old one, which stops working. It's shown once.</p>
              <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" autoComplete="current-password" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={reset}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={doNewKey} disabled={busy || !cur}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Make key"}</Button>
              </div>
            </div>
          )}

          {mode === "forgot" && recoveredPw === null && (
            <RecoveryKeyEntry
              scope="mod-access"
              hint="Enter your recovery key. It lets you set a new mod access password."
              onCancel={reset}
              onRecovered={async (p) => {
                if (!(await verifyModAccessPassword(p))) throw new Error("That key belongs to an older password. Make sure you use the newest one.");
                setRecoveredPw(p); setMode("change"); setError("");
              }}
            />
          )}
        </>
      )}

      <RecoveryKeyDialog
        open={!!recoveryKey} recoveryKey={recoveryKey} scope="mod-access" label="your mod access password"
        onDone={() => setRecoveryKey(null)}
      />
    </div>
  );
}
