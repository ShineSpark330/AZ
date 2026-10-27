// "What became of this plan?" — the Outcome row (Start now / Done / Partly /
// Skipped / Cancelled / Reschedule) for the Plan Activity form in EDIT mode.
//
// Lifted out of the planner's old edit sheet so editing a plan from anywhere
// (planner, widgets, details popup) opens ONE form — the same Plan Activity
// form used to create it — with the outcome at the top. It writes through the
// shared resolvePlan helpers (same path as the details popup and the home
// notices), so every surface agrees on what "Done" or "Skipped" does.

import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Pause, Repeat } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useT } from "@/lib/i18n";
import { statusFor } from "@/lib/activityStatus";
import { getActiveActivities } from "@/lib/activitySession";
import { resolveOutcome, startPlanActive, reschedulePlan } from "@/lib/planner/resolvePlan";
import PlanTimeChoice from "@/components/planner/PlanTimeChoice";

const chipBase = "text-xs px-2.5 py-1 rounded-full border flex items-center gap-1";
const chipQuiet = "border-border/50 text-muted-foreground hover:text-foreground";
const chipLit = "text-[var(--v2-accent)] border-[var(--v2-accent)]";

export default function PlanOutcomeSection({ item, onClose, initialAsk = null }) {
  const tr = useT();
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ["activityCategories"],
    queryFn: () => base44.entities.ActivityCategory.list(),
    enabled: !!item,
  });
  // "start" | "end" | "later" | null — which "when?" chooser is open.
  const [ask, setAsk] = useState(initialAsk);
  useEffect(() => { setAsk(initialAsk); }, [item?.id, initialAsk]);

  if (!item) return null;

  const st = statusFor(item);
  const running = getActiveActivities().some((a) => a.planActivityId === item.id);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["activities"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dailyProgress"] });
  };
  const resolve = async (status, endedAt = null) => {
    try {
      await resolveOutcome(item, status, { endedAt });
      refresh();
      onClose?.();
    } catch (e) { toast.error(e?.message || "Failed"); }
  };
  const start = async (startedAt) => {
    try {
      await startPlanActive(item, { startedAt, categories });
      toast.success(tr("planner.startedToast"));
      refresh();
      onClose?.();
    } catch (e) { toast.error(e?.message || "Failed"); }
  };
  const pause = async () => {
    const sess = getActiveActivities().find((a) => a.planActivityId === item.id);
    if (!sess) return;
    try {
      const { pauseActiveActivity } = await import("@/lib/activitySession");
      const res = await pauseActiveActivity(sess.id);
      refresh();
      if (res) toast.success(`⏸ ${res.name} — ${res.total ?? res.minutes}m saved`);
      onClose?.();
    } catch (e) { toast.error(e?.message || "Couldn't pause"); }
  };
  const moveLater = async (when) => {
    try { await reschedulePlan(item, when); refresh(); onClose?.(); }
    catch (e) { toast.error(e?.message || "Failed"); }
  };
  // Partly done wants to know how much actually happened — the totals count
  // the actual, not the intention.
  const saveActual = async (raw) => {
    const n = parseInt(raw, 10);
    try {
      await base44.entities.Activity.update(item.id, {
        actual_duration_minutes: Number.isFinite(n) && n > 0 ? n : null,
      });
      refresh();
    } catch (e) { toast.error(e?.message || "Failed"); }
  };

  return (
    <section className="space-y-1.5">
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{tr("planner.outcome")}</h3>
      <div className="flex flex-wrap gap-1.5">
        {st === "scheduled" && (running ? (
          <>
            <span className={`${chipBase} ${chipLit}`}><Play className="w-3 h-3" />{tr("planner.inProgress")}</span>
            <button type="button" onClick={pause} className={`${chipBase} ${chipQuiet}`}>
              <Pause className="w-3 h-3" />{tr("planner.pause")}
            </button>
          </>
        ) : (
          <button type="button" aria-pressed={ask === "start"}
            onClick={() => setAsk(ask === "start" ? null : "start")}
            className={`${chipBase} ${chipLit}`}>
            <Play className="w-3 h-3" />{tr("planner.startNow")}
          </button>
        ))}
        {[["done", tr("planner.done")], ["partial", tr("planner.partial")],
          ["skipped", tr("planner.skipped")], ["cancelled", tr("planner.cancelled")]].map(([id, label]) => {
          const lit = st === id || (id === "done" && ask === "end");
          return (
            <button key={id} type="button" aria-pressed={lit}
              onClick={() => (id === "done" ? setAsk(ask === "end" ? null : "end") : resolve(id))}
              className={`${chipBase} ${lit ? chipLit : chipQuiet}`}>{label}</button>
          );
        })}
        <button type="button" aria-pressed={ask === "later"}
          onClick={() => setAsk(ask === "later" ? null : "later")}
          className={`${chipBase} ${ask === "later" ? chipLit : chipQuiet}`}>
          <Repeat className="w-3 h-3" />{tr("planner.reschedule")}
        </button>
      </div>
      {ask === "start" && (
        <PlanTimeChoice kind="start" item={item} onPick={(d) => { setAsk(null); start(d); }} />
      )}
      {ask === "end" && (
        <PlanTimeChoice kind="end" item={item} onPick={(d) => { setAsk(null); resolve("done", d); }} />
      )}
      {ask === "later" && (
        <PlanTimeChoice kind="later" item={item} onPick={(d) => { setAsk(null); moveLater(d); }} />
      )}
      {st === "partial" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {tr("planner.actualMin")}
          <input type="number" min={1} step={5}
            defaultValue={item.actual_duration_minutes ?? ""}
            onBlur={(e) => saveActual(e.target.value)}
            className="w-20 h-8 px-2 rounded-lg border border-input bg-background text-sm" />
        </label>
      )}
    </section>
  );
}
