// Mods: install, switch on/off, set permissions, open and remove mods that
// other people made and shared as .osmod files. See docs/mods.md.
import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Puzzle, Upload, ShieldCheck, Trash2, Download, ExternalLink, Lock, Loader2, RotateCcw, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { localEntities } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { confirm } from "@/components/shared/ConfirmDialog";
import { useTerms } from "@/lib/useTerms";
import { parseModFile, parseDataFile, MOD_PERMISSIONS, applyModTerms, ModFormatError } from "@/lib/mods/modPackage";
import {
  useMods, installMod, setModEnabled, setModPermissions, uninstallMod,
  exportModPackage, exportModData, deleteModData, grantDataAccess, MODS_QUERY_KEY,
  narrowDataAccess, resetModDataToTemplate, restoreModData, importModData, saveCurrentAsTemplate, restoreOriginalTemplate, effectiveTemplate,
} from "@/lib/mods/modStore";
import { isDataScope, dataScopeLabel, DATA_SCOPE_GROUPS, hasModAccessPassword, getAllowedRoles } from "@/lib/mods/modAccess";
import { modPagePath } from "@/lib/mods/registry";
import { openExternalUrl } from "@/lib/openExternalUrl";

function PermissionRow({ perm, checked, onChange, terms }) {
  const meta = MOD_PERMISSIONS[perm];
  if (!meta) return null;
  // Heavy permissions are never a plain tick: they're granted with the mod
  // access password in the panel below (DataAccessPanel).
  if (meta.heavy) {
    return (
      <div className="flex items-start gap-2.5 py-1.5">
        <Lock className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span>
          <span className="text-sm font-medium block">{applyModTerms(meta.label, terms)}</span>
          <span className="text-xs text-muted-foreground block">{applyModTerms(meta.detail, terms)}</span>
          <span className="text-xs block mt-0.5">{checked ? "Allowed." : "Not allowed. You can allow it after installing, from this mod's card."}</span>
        </span>
      </div>
    );
  }
  return (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span>
        <span className="text-sm font-medium block">{applyModTerms(meta.label, terms)}</span>
        <span className="text-xs text-muted-foreground block">{applyModTerms(meta.detail, terms)}</span>
      </span>
    </label>
  );
}

function InstallDialog({ pending, existing, existingCount, onClose, onInstalled, terms }) {
  const [granted, setGranted] = useState(() => new Set(existing?.granted_permissions || []));
  const [busy, setBusy] = useState(false);
  // Saved data that travelled inside the file. Ticked by default only when
  // there's nothing of this mod's already here to be replaced.
  const fileData = pending?.data?.records || [];
  const [restore, setRestore] = useState(() => fileData.length > 0 && !existingCount);
  if (!pending) return null;
  const toggle = (p, on) => setGranted((s) => { const n = new Set(s); on ? n.add(p) : n.delete(p); return n; });
  const doInstall = async () => {
    setBusy(true);
    try {
      // Restoring over existing data saves a copy of it first. If that copy
      // can't be saved, stop before anything is changed.
      if (restore && fileData.length && existingCount > 0) {
        const res = await restoreModData(pending.mod_id, pending.name, [], { replace: true });
        if (!res.saved) { toast.error("The copy of your current data wasn't saved, so nothing was changed."); return; }
      }
      await installMod(pending, [...granted], { seedTemplate: !(restore && fileData.length) });
      if (restore && fileData.length) {
        const res = await restoreModData(pending.mod_id, pending.name, fileData);
        toast.success(`${pending.name} ${existing ? "updated" : "installed"}, ${res.restored} saved ${res.restored === 1 ? "item" : "items"} restored`);
      } else {
        toast.success(existing ? `${pending.name} updated` : `${pending.name} installed`);
      }
      onInstalled();
    } catch (e) {
      toast.error(e?.message || "Couldn't install the mod");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Puzzle className="w-5 h-5 text-primary" /> {existing ? "Update" : "Install"} {pending.name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Version {pending.version}{pending.author ? ` · by ${pending.author}` : ""}
            {existing ? ` · you have ${existing.version}` : ""}
          </p>
          {pending.description && <p>{pending.description}</p>}
          <div>
            <p className="font-medium">Adds {pending.pages.length === 1 ? "a page" : "pages"}:</p>
            <p className="text-muted-foreground">{pending.pages.map((p) => p.title).join(", ")}</p>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="font-medium flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-primary" /> What it can see</p>
            <p className="text-xs text-muted-foreground mt-1">
              It can always keep its own notes and see your words for {terms.alters}, {terms.fronting} and so on.
              {pending.permissions.length ? " It also asks for these. Tick only what you're happy to share; you can change this later." : " It doesn't ask to see anything else."}
            </p>
            {pending.permissions.map((p) => (
              <PermissionRow key={p} perm={p} terms={terms} checked={granted.has(p)} onChange={(on) => toggle(p, on)} />
            ))}
          </div>
          {fileData.length > 0 && (
            <label className="flex items-start gap-2.5 rounded-xl border border-border/60 p-3 cursor-pointer">
              <Checkbox checked={restore} onCheckedChange={(v) => setRestore(!!v)} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium block">
                  {existingCount > 0 ? "Replace its saved data with the data in this file" : "Restore the saved data in this file"}
                </span>
                <span className="text-xs text-muted-foreground block">
                  {fileData.length} saved {fileData.length === 1 ? "item" : "items"}{pending.data.exported_at ? `, saved ${new Date(pending.data.exported_at).toLocaleDateString()}` : ""}.
                  {existingCount > 0 ? ` You have ${existingCount} now; a copy of them is saved to your device first, and if that copy can't be saved nothing changes.` : ""}
                </span>
              </span>
            </label>
          )}
          {fileData.length === 0 && (pending.template || []).length > 0 && !existing && existingCount === 0 && (
            <p className="text-xs text-muted-foreground">It starts with {pending.template.length} starter {pending.template.length === 1 ? "item" : "items"}. You can put it back to this starting state any time from its card.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Mods are made by other people, not by Apeiron Zetta. Each one runs walled off from the rest of the app with no internet access, and can't change or delete anything outside its own data. Only install mods from people you trust.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={doInstall} disabled={busy}>{existing ? "Update" : "Install"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The heavy "read your app data" grant: mod access password + an allowed-role
// {{alter}} {{fronting}}, enforced in modStore.grantDataAccess. Revoking is one tap.
// "Read your app data". One master tick ("All of the system data") and, under
// "Choose what it can read", a tick per group of records (how many alters,
// history and calendar, journals and check-ins, tracking, chat, bulletin
// board, timeline…). Narrowing what a mod can read never needs the password;
// widening it (or the first allow) does, plus the allowed role fronting.
function DataAccessPanel({ mod, terms, refresh }) {
  const granted = (mod.granted_permissions || []).includes("data:read");
  const requested = (mod.requested_data_scopes || []).filter(isDataScope);
  const current = useMemo(() => new Set(granted ? (mod.data_scopes || []).filter(isDataScope) : []), [granted, mod.data_scopes]);
  const [picked, setPicked] = useState(() => new Set(granted ? current : requested));
  const [showAdv, setShowAdv] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasPw = hasModAccessPassword();
  const roles = getAllowedRoles();
  const fill = (t) => applyModTerms(t, terms);
  const setMany = (scopes, on) => setPicked((prev) => { const n = new Set(prev); scopes.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });
  const groups = DATA_SCOPE_GROUPS
    .map((g) => ({ ...g, scopes: g.scopes.filter((x) => requested.includes(x)) }))
    .filter((g) => g.scopes.length);
  const state = (scopes) => (scopes.every((x) => picked.has(x)) ? true : scopes.some((x) => picked.has(x)) ? "indeterminate" : false);
  const adding = [...picked].some((x) => !current.has(x));
  const changed = granted ? (adding || [...current].some((x) => !picked.has(x))) : true;
  const needsPw = !granted || adding;

  const save = async () => {
    setBusy(true); setError("");
    try {
      if (!picked.size) { await revoke(); return; }
      if (needsPw) await grantDataAccess(mod, [...picked], password);
      else await narrowDataAccess(mod, [...picked]);
      setPassword("");
      toast.success(granted ? `${mod.name} can read what you picked` : `${mod.name} can now read the records you picked`);
      refresh();
    } catch (e) { setError(fill(e?.message || "Couldn't allow that.")); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    try { await setModPermissions(mod, (mod.granted_permissions || []).filter((p) => p !== "data:read")); toast.success("Data access taken away"); refresh(); }
    catch (e) { toast.error(e?.message || "Couldn't take that away"); }
  };

  const picker = (
    <>
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <Checkbox checked={state(requested)} onCheckedChange={(v) => setMany(requested, v === true)} />
        All of the system data
      </label>
      <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setShowAdv((v) => !v)}>
        {showAdv ? "Hide the list" : "Choose what it can read"}
      </button>
      {showAdv && (
        <div className="space-y-2 pl-1">
          {groups.map((g) => (
            <label key={g.id} className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={state(g.scopes)} onCheckedChange={(v) => setMany(g.scopes, v === true)} className="mt-0.5" />
              <span>
                {fill(g.label)}
                <span className="text-xs text-muted-foreground block">{fill(g.detail)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <p className="text-sm font-medium flex items-center gap-1.5"><Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" /> Read your app data</p>
      {!granted && !hasPw ? (
        <p className="text-xs text-muted-foreground">To allow this, set a mod access password in Settings → Data &amp; privacy → Storage &amp; encryption → Mod data access.</p>
      ) : !requested.length ? (
        <p className="text-xs text-muted-foreground">This mod asks to read your data but doesn't say which records, so it can't be allowed. Ask its maker to list them.</p>
      ) : (
        <>
          {granted ? (
            <p className="text-xs text-muted-foreground">
              Allowed to read: {(mod.data_scopes || []).map((k) => fill(dataScopeLabel(k))).join(", ") || "nothing"}.
              {roles.length ? ` Only works while a ${roles.join(" / ")} ${terms.alter} is ${terms.fronting}.` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Pick what it may read (read-only; locked journal entries stay locked, private chat channels are never included). Untick to keep it out.</p>
          )}
          {picker}
          {needsPw && changed && (
            <>
              <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="Mod access password" autoComplete="off" className="h-8 text-sm" />
              {roles.length > 0 && <p className="text-xs text-muted-foreground">A {roles.join(" / ")} {terms.alter} must be {terms.fronting} to allow this.</p>}
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {(!granted || changed) && (
              <Button size="sm" onClick={save} disabled={busy || (needsPw && picked.size > 0 && !password)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : granted ? (picked.size ? "Save changes" : "Take away access") : "Allow"}
              </Button>
            )}
            {granted && <Button size="sm" variant="outline" onClick={revoke}>Take away access</Button>}
          </div>
        </>
      )}
    </div>
  );
}

// "Export data": one button, one tick. Unticked saves just the data (a small
// file you load back with Import data). Ticked saves a .osmod: the mod itself,
// its starting template and the data, which you can install anywhere.
function ExportDataDialog({ mod, dataCount, onClose }) {
  const [withMod, setWithMod] = useState(false);
  const [busy, setBusy] = useState(false);
  const mustIncludeMod = dataCount === 0;
  const includeMod = withMod || mustIncludeMod;
  const go = async () => {
    setBusy(true);
    try {
      const res = includeMod
        ? await exportModPackage(mod, { includeData: true })
        : await exportModData(mod.mod_id, mod.name);
      if (["downloaded", "shared", "filesystem"].includes(res?.result)) {
        toast.success(includeMod ? `${mod.name} exported` : `${mod.name}'s data exported`);
        onClose();
      } else if (res?.result === "failed") {
        toast.error("The file couldn't be saved.");
      }
    } catch (e) {
      toast.error(e?.message || "Couldn't export it");
    } finally { setBusy(false); }
  };
  const items = `${dataCount} saved ${dataCount === 1 ? "item" : "items"}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Export {mod.name}'s data</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2.5 rounded-xl border border-border/60 p-3 cursor-pointer">
            <Checkbox checked={includeMod} disabled={mustIncludeMod} onCheckedChange={(v) => setWithMod(!!v)} className="mt-0.5" />
            <span>
              <span className="font-medium block">Also include the mod itself</span>
              <span className="text-xs text-muted-foreground block">
                {mustIncludeMod
                  ? "It has nothing saved yet, so this exports the mod on its own as a .osmod."
                  : "Unticked: just the data. Ticked: a .osmod with the mod, its template and the data, that you can install on another device."}
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {mustIncludeMod
              ? "You'll get a .osmod file."
              : includeMod
                ? `You'll get a .osmod file with ${items}.`
                : `You'll get a data file with ${items}; load it back with Import data on this mod.`}
            {!mustIncludeMod && " The data is saved in readable form (unless the mod scrambles it itself), so keep the file somewhere safe and only share it with people you trust with it."}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={go} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "Import data": the file was already read and checked to belong to this mod.
// A tick decides whether the mod itself is updated too (only for a .osmod), and
// a choice decides between replacing the current data (a copy is saved first)
// and adding to it. A confirmation sums up exactly what will happen.
function ImportDataDialog({ mod, dataCount, file, onClose, refresh }) {
  const n = file.records.length;
  const [updateMod, setUpdateMod] = useState(false);
  const [replace, setReplace] = useState(dataCount > 0);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const nothing = n === 0 && !updateMod;
  const plural = (c) => `${c} ${c === 1 ? "item" : "items"}`;
  const go = async () => {
    const willReplace = replace && dataCount > 0 && n > 0;
    const lines = [];
    if (n > 0) {
      lines.push(willReplace
        ? `Replace its ${plural(dataCount)} with the ${plural(n)} in the file. A copy of what it has now is saved to your device first; if that doesn't work, nothing changes.`
        : dataCount > 0
          ? `Add the ${plural(n)} in the file to its ${plural(dataCount)}.`
          : `Load the ${plural(n)} in the file.`);
    }
    if (updateMod && file.mod) lines.push(`Update the mod itself to version ${file.mod.version}. It keeps the permissions you've allowed; any new ones stay off until you turn them on.`);
    setHidden(true);
    const ok = await confirm({
      title: `Import into ${mod.name}?`,
      body: lines.join(" "),
      confirmLabel: "Import",
      destructive: willReplace || updateMod,
    });
    if (!ok) { setHidden(false); return; }
    setBusy(true);
    try {
      const res = await importModData(mod, file, { replace: willReplace, updateMod });
      if (!res.saved) { toast.error("The copy of your current data wasn't saved, so nothing was changed."); setHidden(false); setBusy(false); return; }
      const parts = [];
      if (n > 0) parts.push(`${plural(res.restored)} loaded`);
      if (res.updated) parts.push("mod updated");
      toast.success(`${mod.name}: ${parts.join(", ")}`);
      refresh();
      onClose();
    } catch (e) {
      toast.error(e?.message || "Couldn't import it");
      setHidden(false); setBusy(false);
    }
  };
  return (
    <Dialog open={!hidden} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Import data into {mod.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {n > 0
              ? `${plural(n)} found${file.exported_at ? `, saved ${new Date(file.exported_at).toLocaleDateString()}` : ""}.`
              : "This file has no saved data in it."}
          </p>
          {file.mod && (
            <label className="flex items-start gap-2.5 rounded-xl border border-border/60 p-3 cursor-pointer">
              <Checkbox checked={updateMod} onCheckedChange={(v) => setUpdateMod(!!v)} className="mt-0.5" />
              <span>
                <span className="font-medium block">Also update the mod itself from this file</span>
                <span className="text-xs text-muted-foreground block">
                  Unticked: only the data is loaded and the mod stays as it is. Ticked: its code{n > 0 ? " and data" : ""} come from this file (version {mod.version || "?"} to {file.mod.version}).
                </span>
              </span>
            </label>
          )}
          {n > 0 && dataCount > 0 && (
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="imp-mode" checked={replace} onChange={() => setReplace(true)} className="mt-1" />
                <span>
                  <span className="font-medium block">Replace what it has now</span>
                  <span className="text-xs text-muted-foreground block">Its {plural(dataCount)} are removed after a copy is saved to your device.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="imp-mode" checked={!replace} onChange={() => setReplace(false)} className="mt-1" />
                <span>
                  <span className="font-medium block">Add to what it has now</span>
                  <span className="text-xs text-muted-foreground block">Keeps its {plural(dataCount)} and adds the file's. Anything in both will show twice.</span>
                </span>
              </label>
            </div>
          )}
          {nothing && file.mod && <p className="text-xs text-muted-foreground">Tick “Also update the mod itself” to load just the mod from this file.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={go} disabled={busy || nothing} className="gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModCard({ mod, dataCount, terms, refresh }) {
  const navigate = useNavigate();
  const run = async (fn, okText) => {
    try { await fn(); if (okText) toast.success(okText); refresh(); }
    catch (e) { toast.error(e?.message || "Something went wrong"); }
  };
  const granted = new Set(mod.granted_permissions || []);
  const removeMod = async () => {
    const ok = await confirm({
      title: `Remove ${mod.name}?`,
      body: dataCount
        ? `Its ${dataCount} saved ${dataCount === 1 ? "item stays" : "items stay"} in the app and in your backups. Install it again to see them, or delete them below this list.`
        : "It has no saved data.",
      confirmLabel: "Remove",
    });
    if (ok) run(() => uninstallMod(mod), `${mod.name} removed`);
  };
  const template = effectiveTemplate(mod);
  const hasTemplate = template.length > 0;
  const hasCustomTemplate = Array.isArray(mod.custom_template);
  const items = (c) => `${c} ${c === 1 ? "item" : "items"}`;
  const [dlg, setDlg] = useState(null);       // "export" | null
  const [importFile, setImportFile] = useState(null);
  const importRef = useRef(null);
  const pickImport = async (file) => {
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) return toast.error("That file is too big to be mod data.");
    try {
      const parsed = parseDataFile(await file.text());
      if (parsed.mod_id !== mod.mod_id) return toast.error(`That file is for “${parsed.mod_name}”, not ${mod.name}.`);
      setImportFile(parsed);
    } catch (e) {
      toast.error(e instanceof ModFormatError ? e.message : "Couldn't read that file");
    }
  };
  const saveAsTemplate = async () => {
    const ok = await confirm({
      title: `Save ${mod.name}'s current data as its template?`,
      body: dataCount > 0
        ? `Its ${items(dataCount)} become the starting state: “Reset to template” goes back to them, and exporting the mod carries them as its template.${hasCustomTemplate ? " This replaces the template you saved before." : hasTemplate ? " This replaces the template it came with (you can bring that back)." : ""} What it has now isn't changed.`
        : `It has nothing saved right now, so its template would be empty and “Reset to template” would clear it.${hasCustomTemplate ? " This replaces the template you saved before." : hasTemplate ? " This replaces the template it came with (you can bring that back)." : ""}`,
      confirmLabel: "Save as template",
    });
    if (!ok) return;
    run(() => saveCurrentAsTemplate(mod), "Saved as its template");
  };
  const useOriginal = async () => {
    const original = Array.isArray(mod.template) ? mod.template.length : 0;
    const ok = await confirm({
      title: `Go back to ${mod.name}'s original template?`,
      body: `The template you saved is dropped. “Reset to template” will use the one that came with the mod${original ? ` (${items(original)})` : ", which is empty"}. What it has now isn't changed.`,
      confirmLabel: "Use original",
    });
    if (!ok) return;
    run(() => restoreOriginalTemplate(mod), "Back to its original template");
  };
  const resetToTemplate = async () => {
    const ok = await confirm({
      title: `Reset ${mod.name} to its template?`,
      body: `This removes the ${items(dataCount)} it saved and puts back its ${items(template.length)} (${hasCustomTemplate ? "the template you saved" : "the template that came with it"}). A copy of what's there now is saved to your device first; if that doesn't work, nothing changes.`,
      confirmLabel: "Save a copy and reset",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await resetModDataToTemplate(mod);
      if (!res.saved) toast.error("The copy wasn't saved, so nothing was changed.");
      else toast.success(`${mod.name} is back to its template (a copy was saved)`);
      refresh();
    } catch (e) { toast.error(e?.message || "Couldn't reset it"); }
  };
  const deleteData = async () => {
    const ok = await confirm({
      title: `Delete ${mod.name}'s data?`,
      body: `This deletes the ${dataCount} ${dataCount === 1 ? "item" : "items"} it saved. A copy is saved to your device first; if that doesn't work, nothing is deleted.`,
      confirmLabel: "Save a copy and delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await deleteModData(mod.mod_id, mod.name);
      if (!res.saved) toast.error("The copy wasn't saved, so nothing was deleted.");
      else toast.success(`Deleted ${res.deleted} ${res.deleted === 1 ? "item" : "items"} (a copy was saved)`);
      refresh();
    } catch (e) { toast.error(e?.message || "Couldn't delete the data"); }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3" data-highlight-id={mod.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{mod.name}</p>
          <p className="text-xs text-muted-foreground">
            Version {mod.version}{mod.author ? ` · by ${mod.author}` : ""} · {dataCount} saved {dataCount === 1 ? "item" : "items"}
          </p>
        </div>
        <Switch
          checked={!!mod.enabled}
          onCheckedChange={(v) => run(() => setModEnabled(mod, v))}
          aria-label={mod.enabled ? `Turn ${mod.name} off` : `Turn ${mod.name} on`}
        />
      </div>
      {mod.description && <p className="text-sm text-muted-foreground">{mod.description}</p>}
      {mod.enabled && (
        <div className="flex flex-wrap gap-2">
          {(mod.pages || []).map((p) => (
            <Button key={p.id} size="sm" variant="secondary" onClick={() => navigate(modPagePath(mod.mod_id, p.id))}>
              {p.title}
            </Button>
          ))}
        </div>
      )}
      {(mod.permissions || []).length > 0 && (
        <div className="rounded-xl border border-border/50 px-3 py-1.5">
          {mod.permissions.map((p) => (
            <PermissionRow
              key={p} perm={p} terms={terms} checked={granted.has(p)}
              onChange={(on) => {
                const next = new Set(granted); on ? next.add(p) : next.delete(p);
                run(() => setModPermissions(mod, [...next]));
              }}
            />
          ))}
        </div>
      )}
      {(mod.permissions || []).includes("data:read") && <DataAccessPanel mod={mod} terms={terms} refresh={refresh} />}
      <div className="flex flex-wrap gap-2 pt-1">
        {mod.homepage && (
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openExternalUrl(mod.homepage)}>
            <ExternalLink className="w-3.5 h-3.5" /> About
          </Button>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => importRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> Import data
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setDlg("export")}>
          <Download className="w-3.5 h-3.5" /> Export data
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={saveAsTemplate}>
          <Bookmark className="w-3.5 h-3.5" /> Save as template
        </Button>
        {hasCustomTemplate && (
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={useOriginal}>
            Use original template
          </Button>
        )}
        {hasTemplate && (
          <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={resetToTemplate}>
            <RotateCcw className="w-3.5 h-3.5" /> Reset to template
          </Button>
        )}
        {dataCount > 0 && (
          <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={deleteData}>
            <Trash2 className="w-3.5 h-3.5" /> Delete its data
          </Button>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={removeMod}>Remove mod</Button>
        <input ref={importRef} type="file" accept=".osmod,.json,application/json,application/octet-stream" className="hidden" onChange={(e) => pickImport(e.target.files?.[0])} />
      </div>
      {dlg === "export" && <ExportDataDialog mod={mod} dataCount={dataCount} onClose={() => setDlg(null)} />}
      {importFile && <ImportDataDialog mod={mod} dataCount={dataCount} file={importFile} onClose={() => setImportFile(null)} refresh={refresh} />}
    </div>
  );
}

export default function Mods() {
  const terms = useTerms();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const { mods } = useMods();
  const [pending, setPending] = useState(null);

  const { data: modData = [] } = useQuery({ queryKey: ["modDataCounts"], queryFn: () => localEntities.ModData.list() });
  const counts = useMemo(() => {
    const m = {};
    for (const r of modData) if (r?.mod_id) m[r.mod_id] = (m[r.mod_id] || 0) + 1;
    return m;
  }, [modData]);
  const installedIds = useMemo(() => new Set(mods.map((m) => m.mod_id)), [mods]);
  const leftovers = Object.entries(counts).filter(([id]) => !installedIds.has(id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: MODS_QUERY_KEY });
    qc.invalidateQueries({ queryKey: ["modDataCounts"] });
  };

  const pickFile = async (file) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    try {
      setPending(parseModFile(await file.text()));
    } catch (e) {
      toast.error(e instanceof ModFormatError ? e.message : "Couldn't read that file.");
    }
  };

  const existing = pending ? mods.find((m) => m.mod_id === pending.mod_id) : null;
  const existingCount = pending ? (counts[pending.mod_id] || 0) : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 os-page-shell" data-tour="mods-page">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-primary" /> Mods
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Add features other people made and shared. A mod adds its own pages, which you can open here or pin to your bars.
          </p>
        </div>
        <Button onClick={() => fileRef.current?.click()} className="gap-1.5 flex-shrink-0">
          <Upload className="w-4 h-4" /> Install
        </Button>
        <input ref={fileRef} type="file" accept=".osmod,.json,application/json" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground flex gap-2">
        <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <span>
          Mods run walled off from the rest of the app with no internet access. A mod only sees your {terms.alters} or who's {terms.fronting} if you tick that for it, and it can never change or delete anything outside its own data. Its data is in your backups, and removing a mod keeps it.
        </span>
      </div>

      {mods.length === 0 ? (
        <div className="text-center py-14 px-4 rounded-2xl border border-dashed border-border/60">
          <Puzzle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            No mods yet. When someone shares a mod file (it ends in <strong>.osmod</strong>), save it to your device and tap <strong>Install</strong>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {mods.map((m) => <ModCard key={m.id} mod={m} dataCount={counts[m.mod_id] || 0} terms={terms} refresh={refresh} />)}
        </div>
      )}

      {leftovers.length > 0 && (
        <div className="rounded-2xl border border-border/60 p-4 space-y-2">
          <p className="font-medium text-sm">Data from removed mods</p>
          <p className="text-xs text-muted-foreground">Kept safe in case you install them again.</p>
          {leftovers.map(([id, n]) => (
            <div key={id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{id} · {n} {n === 1 ? "item" : "items"}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => exportModData(id, id).catch(() => {})}><Download className="w-3.5 h-3.5" /></Button>
                <Button
                  size="sm" variant="ghost" className="text-destructive"
                  onClick={async () => {
                    const ok = await confirm({ title: "Delete this data?", body: `A copy of the ${n} ${n === 1 ? "item" : "items"} is saved to your device first; if that doesn't work, nothing is deleted.`, confirmLabel: "Save a copy and delete", destructive: true });
                    if (!ok) return;
                    const res = await deleteModData(id, id);
                    if (!res.saved) toast.error("The copy wasn't saved, so nothing was deleted.");
                    refresh();
                  }}
                ><Trash2 className="w-3.5 h-3.5" /></Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Want to make a mod? The guide is in the app's source, in docs/mods.md.
      </p>

      {pending && (
        <InstallDialog
          key={pending.mod_id + pending.version}
          pending={pending}
          existing={existing}
          existingCount={existingCount}
          terms={terms}
          onClose={() => setPending(null)}
          onInstalled={() => { setPending(null); refresh(); }}
        />
      )}
    </motion.div>
  );
}
