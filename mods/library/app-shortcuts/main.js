// App shortcuts: an Apeiron Zetta mod.
// A board of tiles. Tap one to open the app on this device. If the app isn't
// installed it says so and offers the link. "Suggestions" lists apps it finds
// installed on this device that you haven't added yet. Everything is stored
// as the mod's own data (collections "shortcut" and "settings"), and the
// starting set lives in template.json (what "Reset to template" restores).
(function () {
  "use strict";
  var S = symphony;
  var CAN = (S.permissions || []).indexOf("apps:launch") !== -1;

  var COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b"];

  // [name, app name (package), icon, group]. Written from memory: if one is
  // wrong for your device, edit that shortcut's app name.
  var CATALOG = [
    ["YouTube", "com.google.android.youtube", "▶️", "Media"],
    ["Spotify", "com.spotify.music", "🎵", "Media"],
    ["Netflix", "com.netflix.mediaclient", "🎬", "Media"],
    ["Twitch", "tv.twitch.android.app", "🟣", "Media"],
    ["VLC", "org.videolan.vlc", "🔶", "Media"],
    ["WhatsApp", "com.whatsapp", "💬", "Messaging"],
    ["Telegram", "org.telegram.messenger", "✈️", "Messaging"],
    ["Discord", "com.discord", "🎮", "Messaging"],
    ["Signal", "org.thoughtcrime.securesms", "🔒", "Messaging"],
    ["Messenger", "com.facebook.orca", "💭", "Messaging"],
    ["Slack", "com.Slack", "#️⃣", "Messaging"],
    ["Zoom", "us.zoom.videomeetings", "📹", "Messaging"],
    ["Instagram", "com.instagram.android", "📷", "Social"],
    ["Facebook", "com.facebook.katana", "👍", "Social"],
    ["X", "com.twitter.android", "🐦", "Social"],
    ["Reddit", "com.reddit.frontpage", "👽", "Social"],
    ["TikTok", "com.zhiliaoapp.musically", "🎶", "Social"],
    ["Pinterest", "com.pinterest", "📌", "Social"],
    ["Snapchat", "com.snapchat.android", "👻", "Social"],
    ["Tumblr", "com.tumblr", "📰", "Social"],
    ["Bluesky", "xyz.blueskyweb.app", "🦋", "Social"],
    ["Mastodon", "org.joinmastodon.android", "🐘", "Social"],
    ["Threads", "com.instagram.barcelona", "🧵", "Social"],
    ["Chrome", "com.android.chrome", "🌐", "Google"],
    ["Gmail", "com.google.android.gm", "✉️", "Google"],
    ["Maps", "com.google.android.apps.maps", "🗺️", "Google"],
    ["Drive", "com.google.android.apps.docs", "📁", "Google"],
    ["Docs", "com.google.android.apps.docs.editors.docs", "📄", "Google"],
    ["Photos", "com.google.android.apps.photos", "🖼️", "Google"],
    ["Calendar", "com.google.android.calendar", "📅", "Google"],
    ["Keep", "com.google.android.keep", "🗒️", "Google"],
    ["Translate", "com.google.android.apps.translate", "🈯", "Google"],
    ["Meet", "com.google.android.apps.tachyon", "📞", "Google"],
    ["Play Store", "com.android.vending", "🛍️", "Google"],
    ["Notion", "notion.id", "📝", "Notes & reading"],
    ["Obsidian", "md.obsidian", "💎", "Notes & reading"],
    ["Kindle", "com.amazon.kindle", "📚", "Notes & reading"],
    ["Wattpad", "wp.wattpad", "📖", "Notes & reading"],
    ["Medium", "com.medium.reader", "✒️", "Notes & reading"],
    ["Firefox", "org.mozilla.firefox", "🦊", "Tools"],
    ["Bitwarden", "com.x8bit.bitwarden", "🔑", "Tools"],
    ["Aegis", "com.beemdevelopment.aegis", "🛡️", "Tools"],
    ["Authenticator", "com.google.android.apps.authenticator2", "🔢", "Tools"],
    ["Duolingo", "com.duolingo", "🦉", "Tools"],
    ["Termux", "com.termux", "⌨️", "Tools"]
  ];

  var PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
  var playLink = function (pkg) { return "https://play.google.com/store/apps/details?id=" + encodeURIComponent(pkg); };
  var linkOf = function (sc) { return sc.link || (sc.package ? playLink(sc.package) : ""); };
  var iconOf = function (sc) { return (sc.emoji || "").trim() || (sc.name || "?").trim().charAt(0).toUpperCase() || "?"; };
  var cmpOrder = function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); };

  var CSS =
    ".as{max-width:640px;margin:0 auto;padding-bottom:12px}" +
    ".as h2{font-size:1.15rem;font-weight:600;margin:0}" +
    ".as .bar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}" +
    ".as .btns{display:flex;gap:6px;flex-wrap:wrap}" +
    ".as .grp{font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:var(--color-text-secondary);margin:14px 0 6px}" +
    ".as .grid{display:grid;gap:10px}" +
    ".as .tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px;border:1px solid var(--color-muted,#8883);border-radius:var(--radius,14px);background:var(--color-surface);color:var(--color-text-primary);cursor:pointer;font:inherit;min-width:0}" +
    ".as .tile:active{transform:scale(.97)}" +
    ".as .ico{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#fff;font-weight:600}" +
    ".as .lbl{font-size:.75rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".as .dot{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:#22c55e}" +
    ".as .dot.no{background:transparent;border:1.5px solid var(--color-text-secondary);opacity:.6}" +
    ".as .note{border:1px solid var(--color-primary);border-radius:var(--radius,14px);padding:10px 12px;margin-bottom:10px;font-size:.9rem}" +
    ".as .note .btns{margin-top:8px}" +
    ".as .row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--color-muted,#8882)}" +
    ".as .row .t{flex:1;min-width:0}" +
    ".as .row .t b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".as .row small{display:block;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".as .ico.sm{width:32px;height:32px;border-radius:10px;font-size:1rem}" +
    ".as label.f{display:block;font-size:.8rem;color:var(--color-text-secondary);margin:8px 0 3px}" +
    ".as .sw{display:flex;gap:6px;flex-wrap:wrap}" +
    ".as .sw button{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer}" +
    ".as .sw button.on{border-color:var(--color-text-primary)}" +
    ".as .hint{font-size:.78rem;color:var(--color-text-secondary);margin:6px 0}" +
    ".as .tiny{padding:2px 8px;min-height:0}";

  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  var btn = function (text, onclick, secondary, extra) {
    return h("button", { type: "button", class: "os-button" + (secondary ? " secondary" : "") + (extra ? " " + extra : ""), onclick: onclick }, text);
  };

  S.registerPage("shortcuts", function (root) {
    var st = {
      items: [], settings: null,
      installed: {},        // package -> true | false | null
      mode: "grid",         // grid | edit | suggest | settings
      form: null,           // { id?, name, package, link, emoji, color, group }
      note: null,           // { text, link?, name? }
      search: "", onlyInstalled: true, stale: false
    };

    function load() {
      return Promise.all([S.data.list("shortcut"), S.data.list("settings")]).then(function (r) {
        st.items = r[0].slice().sort(cmpOrder);
        st.settings = r[1][0] || null;
      });
    }
    function opts() {
      var s = st.settings || {};
      return { columns: Math.min(6, Math.max(2, Number(s.columns) || 4)), labels: s.labels !== false, whenMissing: s.whenMissing === "link" ? "link" : "ask" };
    }
    function checkInstalled(pkgs) {
      if (!CAN) return Promise.resolve();
      var todo = pkgs.filter(function (p) { return p && PKG_RE.test(p) && !(p in st.installed); });
      return todo.reduce(function (chain, p) {
        return chain.then(function () {
          return S.apps.isInstalled(p).then(function (v) { st.installed[p] = v; }, function () { st.installed[p] = null; });
        });
      }, Promise.resolve());
    }
    function refresh() { return load().then(function () { return checkInstalled(st.items.map(function (i) { return i.package; })); }).then(draw); }

    // ---- launching ----
    function openLink(url) {
      S.ui.openLink(url).then(function (r) { if (r !== "opened") S.ui.toast("Couldn't open the link."); }, function (e) { S.ui.toast(e.message || "Couldn't open the link."); });
    }
    function launch(sc) {
      st.note = null;
      if (!CAN) {
        st.note = { text: "Opening apps is turned off for this mod. Turn on “Open apps and links” on the Mods page." };
        return draw();
      }
      if (!sc.package) {
        if (sc.link) return openLink(sc.link);
        st.note = { text: sc.name + " has no app or link yet. Tap Edit to add one." };
        return draw();
      }
      S.ui.openApp(sc.package).then(function (r) {
        if (r === "opened") return;
        var link = linkOf(sc);
        if (r === "not-installed") {
          st.installed[sc.package] = false;
          if (opts().whenMissing === "link" && link) { S.ui.toast(sc.name + " isn't installed. Opening its link."); openLink(link); return draw(); }
          st.note = { text: sc.name + " isn't installed on this device.", link: link, name: sc.name };
        } else if (r === "unsupported") {
          st.note = { text: "This device can't open apps from here." + (link ? " You can open its link instead." : ""), link: link, name: sc.name };
        } else {
          st.note = { text: "Couldn't open " + sc.name + ".", link: link, name: sc.name };
        }
        draw();
      }, function (e) { st.note = { text: e.message || "Couldn't open it." }; draw(); });
    }

    // ---- changes ----
    function move(sc, dir) {
      var group = (sc.group || "").trim();
      var all = st.items.slice();
      var same = all.filter(function (i) { return (i.group || "").trim() === group; });
      var k = same.indexOf(sc), other = same[k + dir];
      if (!other) return;
      var a = all.indexOf(sc), b = all.indexOf(other);
      all[a] = other; all[b] = sc;
      var jobs = [];
      all.forEach(function (it, i) { if (Number(it.order) !== i) jobs.push(S.data.update("shortcut", it.id, { order: i })); });
      Promise.all(jobs).then(refresh);
    }
    function saveForm() {
      var f = st.form;
      var name = f.name.trim(), pkg = f.package.trim(), link = f.link.trim();
      if (!name) return S.ui.toast("Give it a name.");
      if (pkg && !PKG_RE.test(pkg)) return S.ui.toast("The app name should look like com.example.app, or leave it empty.");
      if (link && !/^https:\/\//i.test(link)) return S.ui.toast("Links must start with https://");
      var rec = { name: name, package: pkg, link: link, emoji: f.emoji.trim().slice(0, 4), color: f.color, group: f.group.trim() };
      var p = f.id ? S.data.update("shortcut", f.id, rec) : S.data.create("shortcut", Object.assign(rec, { order: st.items.length ? Math.max.apply(null, st.items.map(function (i) { return Number(i.order) || 0; })) + 1 : 0 }));
      p.then(function () { st.form = null; return refresh(); });
    }
    function addFromCatalog(c) {
      var order = st.items.length ? Math.max.apply(null, st.items.map(function (i) { return Number(i.order) || 0; })) + 1 : 0;
      S.data.create("shortcut", { name: c[0], package: c[1], link: "", emoji: c[2], color: COLORS[order % COLORS.length], group: "", order: order })
        .then(function () { S.ui.toast(c[0] + " added"); return refresh(); });
    }
    function saveSetting(patch) {
      var p = st.settings ? S.data.update("settings", st.settings.id, patch) : S.data.create("settings", patch);
      p.then(refresh);
    }

    // ---- drawing ----
    function tile(sc) {
      var o = opts();
      var inst = sc.package ? st.installed[sc.package] : undefined;
      return h("button", { type: "button", class: "tile", onclick: function () { launch(sc); }, "aria-label": "Open " + sc.name },
        inst === true && h("span", { class: "dot", title: "Installed" }),
        inst === false && h("span", { class: "dot no", title: "Not installed" }),
        h("span", { class: "ico", style: "background:" + (sc.color || COLORS[0]) }, iconOf(sc)),
        o.labels && h("span", { class: "lbl" }, sc.name));
    }
    function groupsOf(items) {
      var order = [], map = {};
      items.forEach(function (i) { var g = (i.group || "").trim(); if (!(g in map)) { map[g] = []; order.push(g); } map[g].push(i); });
      return order.map(function (g) { return { name: g, items: map[g] }; });
    }
    function gridView() {
      var o = opts();
      if (!st.items.length) return h("p", { class: "os-muted" }, "No shortcuts yet. Tap Add, or open Suggestions.");
      var gs = groupsOf(st.items);
      return h("div", null, gs.map(function (g) {
        return h("div", null,
          (g.name || gs.length > 1) && h("div", { class: "grp" }, g.name || "Other"),
          h("div", { class: "grid", style: "grid-template-columns:repeat(" + o.columns + ",minmax(0,1fr))" }, g.items.map(tile)));
      }));
    }
    function editView() {
      if (!st.items.length) return h("p", { class: "os-muted" }, "Nothing to edit yet.");
      return h("div", null, groupsOf(st.items).map(function (g) {
        return h("div", null,
          h("div", { class: "grp" }, g.name || "No group"),
          g.items.map(function (sc, k) {
            return h("div", { class: "row" },
              h("span", { class: "ico sm", style: "background:" + (sc.color || COLORS[0]) }, iconOf(sc)),
              h("div", { class: "t" }, h("b", null, sc.name), h("small", null, sc.package || sc.link || "no app or link")),
              btn("↑", function () { move(sc, -1); }, true, "tiny"),
              btn("↓", function () { move(sc, 1); }, true, "tiny"),
              btn("Edit", function () { st.form = { id: sc.id, name: sc.name || "", package: sc.package || "", link: sc.link || "", emoji: sc.emoji || "", color: sc.color || COLORS[0], group: sc.group || "" }; draw(); }, true, "tiny"));
          }));
      }));
    }
    function formView() {
      var f = st.form;
      var groups = Array.from(new Set(st.items.map(function (i) { return (i.group || "").trim(); }).filter(Boolean)));
      var field = function (label, key, ph, extra) {
        return [h("label", { class: "f" }, label), h("input", Object.assign({ class: "os-input", value: f[key], placeholder: ph || "", autocomplete: "off", oninput: function (e) { f[key] = e.target.value; } }, extra || {}))];
      };
      return h("div", { class: "os-card" },
        h("h2", null, f.id ? "Edit shortcut" : "New shortcut"),
        field("Name", "name", "Spotify"),
        field("App name (what makes the app open)", "package", "com.spotify.music"),
        h("div", { class: "hint" }, "Find it in the app's Play Store link, after id=. Leave empty for a link-only shortcut."),
        field("Link (opened if the app isn't installed)", "link", "https://… (empty: its Play Store page)"),
        field("Icon (an emoji, or empty for its first letter)", "emoji", "🎵"),
        field("Group (optional)", "group", "Media", { list: "as-groups" }),
        h("datalist", { id: "as-groups" }, groups.map(function (g) { return h("option", { value: g }); })),
        h("label", { class: "f" }, "Colour"),
        h("div", { class: "sw" }, COLORS.map(function (c) {
          return h("button", { type: "button", class: f.color === c ? "on" : "", style: "background:" + c, "aria-label": c, onclick: function () { f.color = c; draw(); } });
        })),
        h("div", { class: "btns", style: "margin-top:12px" },
          btn("Save", saveForm),
          btn("Cancel", function () { st.form = null; if (st.stale) { st.stale = false; refresh(); } else draw(); }, true),
          f.id && btn("Remove", function () {
            if (st.confirmRemove !== f.id) { st.confirmRemove = f.id; S.ui.toast("Tap Remove again to delete this shortcut."); return; }
            st.confirmRemove = null;
            S.data.remove("shortcut", f.id).then(function () { st.form = null; return refresh(); });
          }, true)));
    }
    function suggestView() {
      var have = {};
      st.items.forEach(function (i) { if (i.package) have[i.package] = true; });
      var q = st.search.trim().toLowerCase();
      var canTell = CAN && CATALOG.some(function (c) { return st.installed[c[1]] === true || st.installed[c[1]] === false; });
      var list = CATALOG.filter(function (c) {
        if (have[c[1]]) return false;
        if (q && c[0].toLowerCase().indexOf(q) === -1 && c[3].toLowerCase().indexOf(q) === -1) return false;
        if (st.onlyInstalled && canTell && st.installed[c[1]] !== true) return false;
        return true;
      }).sort(function (a, b) { return (st.installed[b[1]] === true ? 1 : 0) - (st.installed[a[1]] === true ? 1 : 0); });
      return h("div", { class: "os-card" },
        h("h2", null, "Suggestions"),
        h("div", { class: "hint" }, canTell ? "Apps from this list that are on this device and not on your board yet." : (CAN ? "This device can't tell which apps are installed, so everything is listed." : "Opening apps is off for this mod, so everything is listed.")),
        h("input", { class: "os-input", placeholder: "Search", value: st.search, oninput: function (e) { st.search = e.target.value; drawKeepFocus(); } }),
        canTell && h("label", { class: "os-row", style: "margin-top:6px;gap:6px" }, h("input", { type: "checkbox", checked: st.onlyInstalled, onchange: function (e) { st.onlyInstalled = e.target.checked; draw(); } }), "Only apps installed here"),
        list.length ? list.map(function (c) {
          return h("div", { class: "row" },
            h("span", { class: "ico sm", style: "background:" + COLORS[CATALOG.indexOf(c) % COLORS.length] }, c[2]),
            h("div", { class: "t" }, h("b", null, c[0]), h("small", null, c[3] + (st.installed[c[1]] === true ? " · installed" : ""))),
            btn("Add", function () { addFromCatalog(c); }, true, "tiny"));
        }) : h("p", { class: "os-muted" }, canTell && st.onlyInstalled ? "Nothing new found here. Untick “Only apps installed here” to see the whole list." : "Nothing matches."));
    }
    function settingsView() {
      var o = opts();
      return h("div", { class: "os-card" },
        h("h2", null, "Settings"),
        h("label", { class: "f" }, "Tiles per row"),
        h("div", { class: "btns" }, [3, 4, 5].map(function (n) { return btn(String(n), function () { saveSetting({ columns: n }); }, o.columns !== n); })),
        h("label", { class: "os-row", style: "margin-top:10px;gap:6px" }, h("input", { type: "checkbox", checked: o.labels, onchange: function (e) { saveSetting({ labels: e.target.checked }); } }), "Show names under the icons"),
        h("label", { class: "f" }, "When an app isn't installed"),
        h("div", { class: "btns" },
          btn("Ask me", function () { saveSetting({ whenMissing: "ask" }); }, o.whenMissing !== "ask"),
          btn("Open its link", function () { saveSetting({ whenMissing: "link" }); }, o.whenMissing !== "link")),
        h("div", { class: "hint" }, "On this mod's card on the Mods page: “Export data” keeps your board (tick “Also include the mod itself” for a file you can install anywhere), “Import data” loads one back, “Save as template” makes your current board the one “Reset to template” returns to."));
    }

    var focusSearch = false;
    function drawKeepFocus() { focusSearch = true; draw(); }
    function draw() {
      root.textContent = "";
      var o = opts();
      var inForm = !!st.form;
      var view = inForm ? formView() : st.mode === "edit" ? editView() : st.mode === "suggest" ? suggestView() : st.mode === "settings" ? settingsView() : gridView();
      var setMode = function (m) { return function () { st.mode = st.mode === m ? "grid" : m; st.form = null; st.note = null; if (st.mode === "suggest") { checkInstalled(CATALOG.map(function (c) { return c[1]; })).then(draw); } draw(); }; };
      root.appendChild(h("div", { class: "as" },
        h("style", null, CSS),
        h("div", { class: "bar" },
          h("h2", null, "App shortcuts"),
          h("div", { class: "btns" },
            btn("Add", function () { st.mode = st.mode === "grid" || st.mode === "edit" ? st.mode : "grid"; st.form = { name: "", package: "", link: "", emoji: "", color: COLORS[st.items.length % COLORS.length], group: "" }; draw(); }),
            btn(st.mode === "edit" ? "Done" : "Edit", setMode("edit"), true),
            btn("Suggestions", setMode("suggest"), st.mode !== "suggest"),
            btn("Settings", setMode("settings"), st.mode !== "settings"))),
        !CAN && h("div", { class: "note" }, "This mod can't open apps right now. Turn on “Open apps and links” for it on the Mods page. Your shortcuts still show here."),
        st.note && h("div", { class: "note" },
          st.note.text,
          h("div", { class: "btns" },
            st.note.link && btn("Open link", function () { openLink(st.note.link); }),
            btn("Dismiss", function () { st.note = null; draw(); }, true))),
        view,
        !inForm && st.mode === "grid" && CAN && st.items.some(function (i) { return i.package && st.installed[i.package] !== undefined && st.installed[i.package] !== null; }) &&
          h("div", { class: "hint" }, "Green dot: installed here. Hollow dot: not installed.")));
      if (focusSearch) { focusSearch = false; var inp = root.querySelector("input.os-input"); if (inp) { inp.focus(); var l = inp.value.length; try { inp.setSelectionRange(l, l); } catch (e) { /* ignore */ } } }
    }

    S.onDataChange(function () {
      if (st.form) { st.stale = true; return; }
      clearTimeout(st.t);
      st.t = setTimeout(refresh, 150);
    });

    root.textContent = "Loading…";
    refresh().catch(function (e) { root.textContent = "Couldn't load: " + (e && e.message || e); });
  });
})();
