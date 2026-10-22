// Shows one page of an installed mod, inside the sandbox.
//
// The frame is public/mod-host.html in <iframe sandbox="allow-scripts">:
// no allow-same-origin, so the mod gets an opaque origin and cannot touch
// the app's storage, cookies or native bridge. This component is its only
// line to the app: it answers the mod's calls through the broker, sizes the
// frame to the mod's content, and tells the mod when its data changes.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { localEntities } from "@/api/base44Client";
import { useTerms } from "@/lib/useTerms";
import { handleModCall } from "@/lib/mods/broker";
import { modPagePath } from "@/lib/mods/registry";

const THEME_VARS = [
  "--font-sans", "--font-display", "--radius",
  "--color-bg", "--color-surface", "--color-surface-rgb", "--color-primary", "--color-secondary",
  "--color-accent", "--color-muted", "--color-text-primary", "--color-text-secondary",
];

function readThemeVars() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const k of THEME_VARS) {
    const v = cs.getPropertyValue(k).trim();
    if (v) out[k] = v;
  }
  return out;
}


// ---- fonts -----------------------------------------------------------------
// The sandbox can't load fonts from the app, so we copy the @font-face rules
// of the person's chosen fonts into it as data: URLs. Cached per font choice.
const FONT_CAP_BYTES = 1.5 * 1024 * 1024;
const fontCache = new Map();

const familiesOf = (value) => String(value || "").split(",")
  .map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

async function sheetRules(sheet) {
  try { return Array.from(sheet.cssRules); } catch { /* cross-origin sheet */ }
  if (sheet.href && /^https:\/\/fonts\.googleapis\.com\//.test(sheet.href)) {
    try {
      const text = await (await fetch(sheet.href)).text();
      const copy = new CSSStyleSheet();
      copy.replaceSync(text);
      return Array.from(copy.cssRules);
    } catch { /* offline */ }
  }
  return [];
}

async function allFontFaceRules() {
  const out = [];
  const walk = async (sheet, base) => {
    for (const r of await sheetRules(sheet)) {
      if (r.type === CSSRule.FONT_FACE_RULE) out.push({ rule: r, base: sheet.href || base });
      else if (r.type === CSSRule.IMPORT_RULE && r.styleSheet) await walk(r.styleSheet, r.styleSheet.href || base);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) await walk(sheet, location.href);
  return out;
}

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = reject;
  fr.readAsDataURL(blob);
});

async function buildFontCss(vars) {
  const wanted = new Set([...familiesOf(vars["--font-sans"]), ...familiesOf(vars["--font-display"])]);
  const key = [...wanted].join("|");
  if (fontCache.has(key)) return fontCache.get(key);
  let css = "";
  let bytes = 0;
  for (const { rule, base } of await allFontFaceRules()) {
    const st = rule.style;
    const family = familiesOf(st.getPropertyValue("font-family"))[0];
    if (!family || !wanted.has(family)) continue;
    const range = st.getPropertyValue("unicode-range");
    if (range && !/U\+0000-00FF/i.test(range)) continue;           // latin subset only
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(st.getPropertyValue("src"));
    if (!m) continue;
    try {
      const blob = await (await fetch(new URL(m[1], base).href)).blob();
      if (bytes + blob.size > FONT_CAP_BYTES) continue;
      bytes += blob.size;
      const url = await toDataUrl(blob);
      css += `@font-face{font-family:"${family}";font-style:${st.getPropertyValue("font-style") || "normal"};` +
             `font-weight:${st.getPropertyValue("font-weight") || "400"};src:url("${url}");}\n`;
    } catch { /* skip this face */ }
  }
  fontCache.set(key, css);
  return css;
}

export default function ModFrame({ mod, pageId }) {
  const terms = useTerms();
  const navigate = useNavigate();
  const frameRef = useRef(null);
  const modRef = useRef(mod);
  modRef.current = mod;
  const queueRef = useRef(Promise.resolve());
  const knownIdsRef = useRef(new Set());
  const loadsRef = useRef(0);
  const [height, setHeight] = useState(240);
  const [stopped, setStopped] = useState("");

  const termValues = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(terms || {})) if (typeof v === "string") out[k] = v;
    return out;
  }, [terms]);
  const termsRef = useRef(termValues);
  termsRef.current = termValues;

  // A new version of the mod, or changed permissions, starts it afresh.
  const frameKey = `${mod.id}:${mod.updated_date || ""}:${pageId}`;

  useEffect(() => {
    loadsRef.current = 0;
    knownIdsRef.current = new Set();
    setStopped("");
    const post = (msg) => frameRef.current?.contentWindow?.postMessage(msg, "*");
    const remember = (value) => {
      const add = (r) => { if (r && typeof r === "object" && typeof r.id === "string") knownIdsRef.current.add(r.id); };
      if (Array.isArray(value)) value.forEach(add); else add(value);
    };

    const onMessage = (event) => {
      const win = frameRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "symphony:hostReady") {
        const m = modRef.current;
        const cssVars = readThemeVars();
        const sendInit = (fontCss) => post({
          type: "symphony:init",
          mod: { id: m.mod_id, name: m.name, version: m.version },
          pageId,
          code: m.code,
          permissions: m.granted_permissions || [],
          terms: termsRef.current,
          cssVars,
          fontCss,
          dark: document.documentElement.classList.contains("dark"),
        });
        // Never hold the mod up for fonts: give them 4 seconds at most.
        Promise.race([buildFontCss(cssVars), new Promise((r) => setTimeout(() => r(""), 4000))])
          .catch(() => "").then(sendInit);
      } else if (msg.type === "symphony:height") {
        const h = Number(msg.height);
        if (Number.isFinite(h)) setHeight(Math.max(120, Math.min(h + 4, 40000)));
      } else if (msg.type === "symphony:blocked") {
        setStopped("blocked");
      } else if (msg.type === "symphony:call") {
        const { callId, method, args } = msg;
        // One call at a time per frame, so a busy mod can't pile up writes.
        queueRef.current = queueRef.current.then(async () => {
          try {
            const value = await handleModCall(modRef.current, String(method), args, {
              toast: (text) => toast(text),
              openPage: (id) => navigate(modPagePath(modRef.current.mod_id, id)),
            });
            remember(value);
            post({ type: "symphony:result", callId, ok: true, value });
          } catch (e) {
            post({ type: "symphony:result", callId, ok: false, error: e?.message || "Request failed" });
          }
        });
      }
    };
    window.addEventListener("message", onMessage);

    const unsubscribe = localEntities.ModData.subscribe((ev) => {
      const modId = modRef.current.mod_id;
      if (ev?.type === "delete") {
        if (knownIdsRef.current.has(ev.id)) post({ type: "symphony:dataChanged", change: { type: "delete", id: ev.id } });
        return;
      }
      if (ev?.data?.mod_id !== modId) return;
      knownIdsRef.current.add(ev.id);
      post({ type: "symphony:dataChanged", change: { type: ev.type, id: ev.id, collection: ev.data.collection } });
    });
    return () => { window.removeEventListener("message", onMessage); unsubscribe(); };
  }, [frameKey, pageId, navigate]);

  // The frame may only ever show the mod host. A second load means the mod
  // navigated its frame somewhere else — stop it rather than keep talking.
  const onLoad = () => {
    loadsRef.current += 1;
    if (loadsRef.current > 1) setStopped("navigated");
  };

  if (stopped === "navigated") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        This mod tried to leave its page, so it was stopped. Nothing was sent anywhere. If this keeps happening, turn the mod off on the Mods page.
      </div>
    );
  }

  return (
    <iframe
      key={frameKey}
      ref={frameRef}
      src="/mod-host.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={mod.name}
      onLoad={onLoad}
      className="w-full border-0 bg-transparent block"
      style={{ height, colorScheme: "normal" }}
    />
  );
}
