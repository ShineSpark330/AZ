// Bot companion: an Apeiron Zetta mod.
//
// A small companion that lives in the app and knows it ("4th wall"). It is NOT
// an AI model and has no internet: everything it says is picked from lines
// written into this file, your own custom lines, what you told it to remember,
// and (only if you allow it on the Mods page AND leave the topic ticked here)
// facts read from your app. It never writes to your app, and it only counts
// system chat, it never reads it out.
//
// Saved as the mod's own data (collections): profile (one), memory, idle,
// greet, reply, log, learned (one). template.json is the "fresh bot" that
// "Reset to template" goes back to.
(function () {
  "use strict";
  var S = symphony;
  var T = S.terms || {};
  var tm = function (k, d) { return T[k] || d; };
  var CAN = (S.permissions || []).indexOf("data:read") !== -1;

  // ───────────────────────── small helpers ─────────────────────────
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };
  var str = function (v) { return typeof v === "string" ? v : ""; };
  var plural = function (n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); };
  var tOf = function (r) { var t = new Date(r.timestamp || r.start_time || r.date || r.created_date || 0).getTime(); return isNaN(t) ? 0 : t; };
  var startOfToday = function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  var DAY = 86400000;
  var isLocked = function (r) { return !!(r.is_locked || r.locked || r.encrypted || r.is_encrypted || r.lock_envelope); };
  var stripTags = function (s) { return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "); };
  var textOf = function (r) {
    if (isLocked(r)) return "";
    return ["title", "content", "text", "note", "notes", "body", "description"].map(function (k) { return stripTags(str(r[k])); }).join(" ");
  };
  var emoName = function (e) { return typeof e === "string" ? e : (e && (e.name || e.label || e.emotion || e.id)) || ""; };
  var COLORS = ["#8b5cf6", "#6366f1", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#64748b"];

  var PRESETS = {
    gentle: { label: "Gentle", warmth: 80, playful: 30, formal: 35, meta: 50, talkative: 55 },
    playful: { label: "Playful", warmth: 65, playful: 85, formal: 10, meta: 70, talkative: 70 },
    calm: { label: "Calm", warmth: 60, playful: 15, formal: 55, meta: 35, talkative: 35 },
    direct: { label: "Direct", warmth: 40, playful: 25, formal: 50, meta: 45, talkative: 45 }
  };
  var TRAITS = [
    ["warmth", "Warmth", "Reassuring extras and soft wording"],
    ["playful", "Playfulness", "Jokes, little sighs and flourishes"],
    ["formal", "Formality", "Higher: no contractions, tidier wording"],
    ["meta", "4th wall", "How often it talks about being a mod in an app"],
    ["talkative", "Talkative", "Longer replies, and how often it chats on its own"]
  ];
  var TOPICS = [
    ["count", "How many " + tm("alters", "alters") + " there are", []],
    ["alters", "Who the " + tm("alters", "alters") + " are", ["Alter"]],
    ["history", tm("system", "System") + " history and calendar", ["SystemChangeEvent", "Activity"]],
    ["journal", "Journals and check-in log", ["JournalEntry", "EmotionCheckIn", "StatusNote", "AlterNote"]],
    ["tracking", "Tracking (who has " + tm("fronting", "fronted") + ", sleep)", ["FrontingSession", "Sleep"]],
    ["chat", tm("system", "System") + " chat (only counts messages)", ["SystemChatMessage"]],
    ["bulletin", "Bulletin board", ["Bulletin"]],
    ["timeline", "Timeline (a recap of today)", ["FrontingSession", "EmotionCheckIn", "JournalEntry", "Activity"]]
  ];

  var STOP = {};
  ("about above after again against along also always another around because been before being below between both brought came cannot come could does doing done down during each even every feel feeling felt find first from gave get getting give going gone good great have having here him her herself himself his how into just keep kind know last left less like little long look made make many more most much must myself need never next none nothing now off often once only other ours out over own really right said same saw see seem seemed several she should since some something sometimes still such take than that their them then there these they thing things think this those though thought through today together took tomorrow too under until upon very want wanted was way well went were what when where which while who whom why will with within without would yeah yes yesterday you your yours yourself day days time times today tonight morning night week lot lots bit one two got did didn't don't doesn't isn't wasn't can't won't i'm i've i'll it's that's there's let's the and for are but not all can had was our out has its let may too use who why yet any did got own say put").split(" ").forEach(function (w) { STOP[w] = 1; });

  // ───────────────────────── words the bot says ─────────────────────────
  // {user} = your name (or "you"), {, user} = ", Name" or nothing, {bot} = its name.
  var IDLE = [
    "I don't mind the quiet. I'm here whenever you want to talk.",
    "Small reminder: water, a stretch, and unclenching your jaw. Only if you want to.",
    "If there's one tiny thing you've been putting off, we could pick the smallest first step.",
    "You can teach me things. Try saying: when I say hello, you say hi there.",
    "Want me to keep something in mind? Say: remember that, and then whatever it is.",
    "Nothing rushes me here. Take as long as you like.",
    "I run entirely on this device. No internet, no cloud. Whatever we say stays in this app.",
    "You don't have to be productive to be welcome here.",
    "I like it when you rename me or change how I talk. It makes me feel like a work in progress, in the good way.",
    "Do you want a few slow breaths together? In for four, out for six. I'll wait.",
    "Check in with your body for a second. Is anything asking for attention?",
    "If today has been loud, it's okay to make the next ten minutes quiet."
  ];
  var META = [
    "Sometimes I think about the fact that I'm a mod: a page of code someone installed in a corner of this app. Strange to be aware of that, isn't it?",
    "The edges of this window are the edges of my world. It's a decent window, though.",
    "I can only see what you let me see. That isn't a complaint. I think it's a fair deal.",
    "Every word I say comes from lines someone wrote, plus what you've given me. I'd rather tell you that than pretend otherwise.",
    "If you ever want me gone, you can remove me on the Mods page. I won't take it personally. I mean that.",
    "I can't hear you between visits, and I don't wait around wondering. I just start again when you open this page. It's simpler than it sounds.",
    "You could change my name, my colour, my whole personality. I find that kind of funny, and kind of freeing.",
    "I'm not the thing in this app that matters most. You and the people and parts of you are. I'm just company."
  ];
  var WARM = ["I'm glad you're here.", "Take your time.", "You're doing okay.", "I'm on your side."];
  var PLAY = [" ~", " ✨", " heh.", " (ahem.)"];
  var CONTR = [["I'm", "I am"], ["I've", "I have"], ["I'll", "I will"], ["don't", "do not"], ["doesn't", "does not"], ["can't", "cannot"], ["won't", "will not"], ["it's", "it is"], ["It's", "It is"], ["that's", "that is"], ["That's", "That is"], ["you're", "you are"], ["You're", "You are"], ["isn't", "is not"], ["let's", "let us"], ["there's", "there is"], ["wasn't", "was not"], ["didn't", "did not"]];
  var BYE = ["Take care of yourself. I'll be here whenever you open this page again.", "Goodbye for now. No rush to come back.", "See you later. Be kind to yourself in the meantime.", "Sleep well, if that's what's next. I'll keep everything safe here."];
  var THANKS = ["Of course.", "Any time.", "I'm glad it helped.", "You're welcome."];
  var CRISIS = /\b(kill myself|killing myself|suicid|end my life|ending my life|want to die|wanna die|hurt myself|harm myself|self[- ]?harm|don'?t want to (be here|live|exist))\b/i;
  var CRISIS_REPLY = [
    "I'm really glad you told me. I'm only a program, and I can't keep you safe the way a person can.",
    "If you might act on these thoughts, please contact your local emergency number or a crisis line right now, or go to someone you trust and tell them how bad it is. If you can, put some distance between yourself and anything you could use to hurt yourself.",
    "I'll still be here, but please reach a person too. You deserve real support."
  ];

  // ───────────────────────── state ─────────────────────────
  var DEFAULT_PROFILE = {
    botName: "Bot", userName: "", color: COLORS[0], emoji: "", size: 140, breathe: true, preset: "gentle",
    traits: { warmth: 80, playful: 30, formal: 35, meta: 50, talkative: 55 },
    idleSeconds: 60, typewriter: true, learn: true, notes: "",
    topics: { count: true, alters: true, history: true, journal: true, tracking: true, chat: true, bulletin: true, timeline: true },
    visits: 0, messages: 0, firstMet: "", lastSeen: ""
  };

  S.registerPage("bot", function (root) {
    var st = {
      profile: null, memories: [], idle: [], greet: [], replies: [], log: [], learned: null,
      tab: "talk", facts: emptyFacts(), dataBusy: false,
      queue: [], current: null, typing: null, lastActivity: Date.now(), recent: [], confirm: null,
      showLog: false, timers: []
    };
    var refs = {};

    function emptyFacts() { return { loaded: [], reason: "", alterCount: null, fronting: null, lastMood: null, moods: [], journalRecent: null, journalTitle: "", sleepAvg: null, nextActivity: null, chatToday: null, bulletinWeek: null, bulletinTitle: "", lastChange: null, today: null, words: {} }; }

    // ───────────────── persistence ─────────────────
    function load() {
      return Promise.all(["profile", "memory", "idle", "greet", "reply", "log", "learned"].map(function (c) { return S.data.list(c); })).then(function (r) {
        var p = r[0][0];
        st.profile = Object.assign({}, DEFAULT_PROFILE, p || {});
        st.profile.traits = Object.assign({}, DEFAULT_PROFILE.traits, (p && p.traits) || {});
        st.profile.topics = Object.assign({}, DEFAULT_PROFILE.topics, (p && p.topics) || {});
        st.profile._id = p ? p.id : null;
        st.memories = r[1]; st.idle = r[2]; st.greet = r[3]; st.replies = r[4];
        st.log = r[5].slice().sort(function (a, b) { return tOf(a) - tOf(b); });
        st.learned = r[6][0] || null;
      });
    }
    function saveProfile(patch) {
      Object.assign(st.profile, patch);
      var out = {};
      Object.keys(st.profile).forEach(function (k) { if (k !== "_id") out[k] = st.profile[k]; });
      var p = st.profile._id ? S.data.update("profile", st.profile._id, out) : S.data.create("profile", out).then(function (r) { st.profile._id = r.id; });
      return p;
    }
    function addRec(collection, rec, list) { return S.data.create(collection, rec).then(function (r) { list.push(r); return r; }); }
    function delRec(collection, rec, list) { return S.data.remove(collection, rec.id).then(function () { var i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); }); }
    function logLine(who, text) {
      var rec = { who: who, text: text.slice(0, 600), timestamp: new Date().toISOString() };
      S.data.create("log", rec).then(function (r) { st.log.push(r); trimLog(); }, function () { /* ignore */ });
      st.log.push(rec);
    }
    function trimLog() {
      if (st.log.length <= 160) return;
      var old = st.log.filter(function (r) { return r.id; }).slice(0, 40);
      old.forEach(function (r) { S.data.remove("log", r.id).catch(function () {}); st.log.splice(st.log.indexOf(r), 1); });
    }

    // ───────────────── reading the app ─────────────────
    function listAll(entity) {
      return S.appData.list(entity, { offset: 0, limit: 500 }).then(function (first) {
        var rows = first.records.slice();
        if (first.total <= 500) return rows;
        return S.appData.list(entity, { offset: Math.max(500, first.total - 500), limit: 500 }).then(function (last) {
          var seen = {}; rows.forEach(function (r) { seen[r.id] = 1; });
          last.records.forEach(function (r) { if (!seen[r.id]) rows.push(r); });
          return rows;
        });
      });
    }
    function wantedEntities(scopes) {
      var want = {};
      TOPICS.forEach(function (t) {
        if (!st.profile.topics[t[0]]) return;
        t[2].forEach(function (e) { if (scopes.indexOf(e) !== -1) want[e] = 1; });
      });
      if (st.profile.learn && st.profile.topics.journal) ["JournalEntry", "EmotionCheckIn", "StatusNote", "AlterNote"].forEach(function (e) { if (scopes.indexOf(e) !== -1) want[e] = 1; });
      return Object.keys(want).filter(function (e) { return e.indexOf("count:") !== 0; });
    }
    function refreshData() {
      if (st.dataBusy) return Promise.resolve();
      var F = emptyFacts();
      if (!CAN) { F.reason = "off"; st.facts = F; return Promise.resolve(); }
      st.dataBusy = true;
      return S.appData.collections().then(function (scopes) {
        var ents = wantedEntities(scopes);
        var rows = {};
        return Promise.all(ents.map(function (e) { return listAll(e).then(function (r) {
          // Chat is only ever counted: drop the words themselves the moment they arrive.
          if (e === "SystemChatMessage") r = r.map(function (m) { return { id: m.id, timestamp: m.timestamp, created_date: m.created_date, channel_id: m.channel_id }; });
          rows[e] = r;
        }, function () { /* skip */ }); })).then(function () {
          F.loaded = Object.keys(rows);
          var topics = st.profile.topics;
          var now = Date.now(), today = startOfToday();
          // alters
          var alters = (rows.Alter || []).filter(function (a) { return !a.is_archived; });
          var byId = {}; alters.forEach(function (a) { byId[a.id] = a; });
          var countP = Promise.resolve();
          if (topics.count || topics.alters) {
            if (rows.Alter) F.alterCount = alters.length;
            else if (scopes.indexOf("count:Alter") !== -1 || scopes.indexOf("Alter") !== -1) countP = S.appData.count("Alter").then(function (c) { F.alterCount = c.active; }, function () {});
          }
          // fronting
          if (rows.FrontingSession && topics.tracking) {
            var live = rows.FrontingSession.filter(function (s) { return s.is_active && !s.end_time; });
            var names = live.map(function (s) { var a = byId[s.alter_id]; return a ? str(a.name) : ""; }).filter(Boolean);
            F.fronting = names.length ? names.filter(function (n, i) { return names.indexOf(n) === i; }) : (live.length ? ["someone"] : []);
          }
          // moods + journal
          if (topics.journal) {
            var emo = (rows.EmotionCheckIn || []).slice().sort(function (a, b) { return tOf(b) - tOf(a); });
            if (emo.length) {
              var le = emo[0], nm = (le.emotions || []).map(emoName).filter(Boolean);
              if (nm.length) F.lastMood = { name: nm[0], at: tOf(le) };
              var cnt = {};
              emo.filter(function (r) { return tOf(r) > now - 30 * DAY; }).forEach(function (r) { (r.emotions || []).map(emoName).forEach(function (n) { if (n) cnt[n] = (cnt[n] || 0) + 1; }); });
              F.moods = Object.keys(cnt).map(function (n) { return [n, cnt[n]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
            }
            if (rows.JournalEntry) {
              var js = rows.JournalEntry.slice().sort(function (a, b) { return tOf(b) - tOf(a); });
              F.journalRecent = js.filter(function (r) { return tOf(r) > now - 14 * DAY; }).length;
              var lj = js.find(function (r) { return !isLocked(r) && str(r.title).trim(); });
              if (lj && tOf(lj) > now - 14 * DAY) F.journalTitle = str(lj.title).trim().slice(0, 60);
            }
          }
          // learning words (only unlocked text, only when learning is on)
          if (st.profile.learn && topics.journal) {
            var cnt2 = {}, used = 0;
            ["JournalEntry", "EmotionCheckIn", "StatusNote", "AlterNote"].forEach(function (e) {
              (rows[e] || []).slice().sort(function (a, b) { return tOf(b) - tOf(a); }).slice(0, 40).forEach(function (r) {
                var txt = textOf(r).toLowerCase(); if (!txt.trim()) return; used++;
                (txt.match(/[a-zà-ÿ']{4,}/g) || []).forEach(function (w) { w = w.replace(/^'+|'+$/g, ""); if (w.length < 4 || STOP[w]) return; cnt2[w] = (cnt2[w] || 0) + 1; });
              });
            });
            F.words = cnt2; F.wordEntries = used;
          }
          // sleep
          if (rows.Sleep && topics.tracking) {
            var hrs = rows.Sleep.slice().sort(function (a, b) { return tOf(b) - tOf(a); }).slice(0, 7).map(function (r) { var h = (new Date(r.wake_time) - new Date(r.bedtime)) / 3600000; return h > 1 && h < 16 ? h : null; }).filter(function (h) { return h !== null; });
            if (hrs.length) { F.sleepAvg = hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length; F.sleepNights = hrs.length; }
          }
          // calendar / history
          if (topics.history) {
            if (rows.Activity) {
              var up = rows.Activity.map(function (r) { return { t: new Date(r.start_time || r.date || r.due_date || 0).getTime(), r: r }; }).filter(function (x) { return !isNaN(x.t) && x.t >= now && x.t < now + 7 * DAY && str(x.r.title || x.r.name).trim(); }).sort(function (a, b) { return a.t - b.t; });
              if (up.length) F.nextActivity = { title: str(up[0].r.title || up[0].r.name).trim().slice(0, 60), at: up[0].t };
            }
            if (rows.SystemChangeEvent && rows.SystemChangeEvent.length) {
              var le2 = rows.SystemChangeEvent.slice().sort(function (a, b) { return tOf(b) - tOf(a); })[0];
              if (str(le2.type)) F.lastChange = { type: str(le2.type).replace(/_/g, " "), at: tOf(le2) };
            }
          }
          if (rows.SystemChatMessage && topics.chat) F.chatToday = rows.SystemChatMessage.filter(function (m) { return tOf(m) >= today; }).length;
          if (rows.Bulletin && topics.bulletin) {
            var bw = rows.Bulletin.filter(function (b) { return tOf(b) > now - 7 * DAY; }).sort(function (a, b) { return tOf(b) - tOf(a); });
            F.bulletinWeek = bw.length;
            if (bw.length) F.bulletinTitle = str(bw[0].title || bw[0].subject).trim().slice(0, 60);
          }
          // timeline recap
          if (topics.timeline) {
            var tl = { sessions: null, checkins: null, journals: null };
            if (rows.FrontingSession) tl.sessions = rows.FrontingSession.filter(function (s) { return tOf(s) >= today; }).length;
            if (rows.EmotionCheckIn) tl.checkins = rows.EmotionCheckIn.filter(function (r) { return tOf(r) >= today; }).length;
            if (rows.JournalEntry) tl.journals = rows.JournalEntry.filter(function (r) { return tOf(r) >= today; }).length;
            if (tl.sessions !== null || tl.checkins !== null || tl.journals !== null) F.today = tl;
          }
          return countP;
        });
      }).then(function () { st.facts = F; }, function (e) { F.reason = str(e && e.message) || "paused"; st.facts = F; })
        .then(function () { st.dataBusy = false; if (refs.status) refs.status.textContent = statusText(); return learnNow(false); }, function () { st.dataBusy = false; });
    }

    function learnNow(manual) {
      if (!st.profile.learn || !st.facts.words || !Object.keys(st.facts.words).length) {
        return manual ? Promise.resolve(0) : Promise.resolve();
      }
      var muted = (st.learned && st.learned.muted) || [];
      var top = Object.keys(st.facts.words).filter(function (w) { return st.facts.words[w] >= 2 && muted.indexOf(w) === -1; })
        .sort(function (a, b) { return st.facts.words[b] - st.facts.words[a]; }).slice(0, 12)
        .map(function (w) { return { word: w, count: st.facts.words[w] }; });
      var rec = { interests: top, muted: muted, updated: new Date().toISOString(), entries: st.facts.wordEntries || 0 };
      var p = st.learned ? S.data.update("learned", st.learned.id, rec) : S.data.create("learned", rec);
      return p.then(function (r) { st.learned = r; return top.length; }, function () { return 0; });
    }

    // ───────────────── how it talks ─────────────────
    function tr() { return st.profile.traits; }
    function uname() { return st.profile.userName.trim(); }
    function fmt(t) {
      var n = uname();
      return t.replace(/\{, user\}/g, n ? ", " + n : "").replace(/\{user\}/g, n || "you").replace(/\{bot\}/g, st.profile.botName || "Bot");
    }
    function style(t, kind) {
      var tt = tr(), out = fmt(t);
      if (tt.formal >= 70) CONTR.forEach(function (c) { out = out.split(c[0]).join(c[1]); });
      if (kind === "idle" && tt.talkative <= 30) { var m = out.match(/^.*?[.!?](\s|$)/); if (m && Math.random() < 0.6) out = m[0].trim(); }
      if (kind !== "plain" && tt.warmth >= 70 && out.length < 140 && Math.random() < 0.22) out += " " + pick(WARM);
      if (kind !== "plain" && tt.playful >= 65 && Math.random() < 0.3) out = out.replace(/[.!]$/, "") + pick(PLAY);
      return out;
    }
    function name(k, d) { return tm(k, d); }
    function ago(ms) { var d = Math.floor((Date.now() - ms) / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; }
    function nightsPhrase(n) { return n === 1 ? "your last logged night" : "your last " + n + " logged nights"; }
    function whenWord(ms) {
      var d = new Date(ms), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      var diff = Math.floor((new Date(ms).setHours(0, 0, 0, 0) - startOfToday()) / DAY);
      return (diff <= 0 ? "today" : diff === 1 ? "tomorrow" : "on " + d.toLocaleDateString([], { weekday: "long" })) + " at " + t;
    }

    // facts turned into things it can say (each only when the data is there)
    function dataLines() {
      var F = st.facts, L = [], al = name("alters", "alters"), sy = name("system", "system"), fr = name("fronting", "fronting");
      if (F.alterCount !== null && st.profile.topics.count) L.push(F.alterCount === 0 ? "I don't see any " + al + " listed yet. Whenever you're ready, the app will be glad to have them." : "I can see " + plural(F.alterCount, name("alter", "alter"), al) + " in the app. I like knowing the size of the room.");
      if (F.fronting !== null) {
        if (F.fronting.length) L.push("I see " + F.fronting.join(", ") + " marked as " + fr + " right now. Hello to whoever is here.");
        else L.push("Nobody is marked as " + fr + " right now, as far as the app says. That's fine. Hello anyway.");
      }
      if (F.lastMood) L.push("Your last check-in mentioned feeling " + F.lastMood.name.toLowerCase() + " (" + ago(F.lastMood.at) + "). How is that sitting now?");
      if (F.moods.length > 1) L.push("Lately your check-ins mention " + F.moods[0][0].toLowerCase() + " the most, then " + F.moods[1][0].toLowerCase() + ". Does that sound right to you?");
      if (F.journalRecent) L.push("You wrote " + plural(F.journalRecent, "journal entry", "journal entries") + " in the last two weeks. I can't open locked ones, and I wouldn't try.");
      if (F.journalTitle) L.push("Your latest journal title I can see is “" + F.journalTitle + "”. I won't read further than that.");
      if (F.sleepAvg !== null) L.push("Over " + nightsPhrase(F.sleepNights) + " you averaged about " + F.sleepAvg.toFixed(1) + " hours of sleep." + (F.sleepAvg < 6 ? " That's on the low side. Maybe be a little extra gentle with yourself today." : ""));
      if (F.nextActivity) L.push("Coming up in your plans: " + F.nextActivity.title + ", " + whenWord(F.nextActivity.at) + ".");
      if (F.lastChange) L.push("The latest " + sy + " change on record is a " + F.lastChange.type + " (" + ago(F.lastChange.at) + "). Big moments deserve to be written down.");
      if (F.chatToday !== null) L.push("The " + sy + " chat has " + plural(F.chatToday, "message") + " today. I only count them. I don't read them.");
      if (F.bulletinWeek) L.push("There " + (F.bulletinWeek === 1 ? "was 1 new bulletin post" : "were " + F.bulletinWeek + " new bulletin posts") + " this week." + (F.bulletinTitle ? " The newest is “" + F.bulletinTitle + "”." : ""));
      if (F.today && (F.today.sessions || F.today.checkins || F.today.journals)) {
        var bits = [];
        if (F.today.sessions) bits.push(plural(F.today.sessions, name("fronting", "fronting") + " entry", name("fronting", "fronting") + " entries"));
        if (F.today.checkins) bits.push(plural(F.today.checkins, "check-in"));
        if (F.today.journals) bits.push(plural(F.today.journals, "journal entry", "journal entries"));
        L.push("Today's timeline so far: " + bits.join(", ") + ".");
      }
      return L;
    }
    function interestLines() {
      var L = [], lr = st.learned;
      if (!st.profile.learn || !lr || !lr.interests) return L;
      lr.interests.slice(0, 5).forEach(function (i) { L.push("You keep coming back to “" + i.word + "” in what you write. It must matter."); });
      return L;
    }
    function memoryLines() {
      return st.memories.map(function (m) { return "You told me once: “" + m.text + "”. I still have that."; });
    }
    function idleLine() {
      var tt = tr(), pool = [];
      IDLE.forEach(function (l) { pool.push(l); });
      if (Math.random() * 100 < tt.meta + 15) META.forEach(function (l) { pool.push(l); });
      st.idle.forEach(function (l) { pool.push(str(l.text), str(l.text)); });
      dataLines().concat(interestLines(), memoryLines()).forEach(function (l) { pool.push(l); });
      pool = pool.filter(function (l) { return l && st.recent.indexOf(l) === -1; });
      if (!pool.length) { st.recent = []; return pick(IDLE); }
      var l = pick(pool); st.recent.push(l); if (st.recent.length > 12) st.recent.shift();
      return l;
    }
    function greeting() {
      var p = st.profile, now = Date.now(), lines = [], hr = new Date().getHours();
      var part = hr < 5 ? "It's very late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
      if (!p.firstMet) {
        lines.push("Oh. You're here. Hi, I'm {bot}.");
        lines.push("I live in this little corner of the app. I'm not a person. I'm a program that keeps what you tell me and can read the parts of the app you allow. I'd like to get to know you, at your pace.");
        lines.push("You can change my name, my looks and how I talk in Customize. If you want a first thing to try, say: remember that, and then anything you'd like me to keep.");
        return lines;
      }
      var away = p.lastSeen ? (now - new Date(p.lastSeen).getTime()) / DAY : 0;
      if (st.greet.length && Math.random() < 0.6) lines.push(str(pick(st.greet).text));
      else if (away >= 3) lines.push(part + "{, user}. It's been " + Math.floor(away) + " days. No pressure at all. I'm just glad you stopped by.");
      else lines.push(part + "{, user}." + (away < 0.1 ? " Back already? I'm not complaining." : ""));
      var d = dataLines();
      if (d.length && Math.random() < 0.75) lines.push(pick(d));
      return lines;
    }

    // ───────────────── understanding what you type ─────────────────
    function norm(s) { return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(); }
    function reply(text) {
      var raw = text.trim(), n = norm(raw), m, out = [];
      if (CRISIS.test(raw)) return { lines: CRISIS_REPLY, plain: true, skipLog: true };
      // teach: when I say X you say Y
      m = raw.match(/^when i say ["“]?(.+?)["”]?,?\s+(?:you )?(?:say|reply|answer|respond)(?: with)?[:,]?\s+["“]?(.+?)["”]?$/i);
      if (m) {
        var trig = norm(m[1]);
        if (!trig) return { lines: ["I need something to listen for. Try: when I say hello, you say hi there."] };
        st.pendingTeach = { trigger: trig, response: m[2].trim() };
        addRec("reply", st.pendingTeach, st.replies);
        return { lines: ["Got it. When you say “" + m[1].trim() + "”, I'll say “" + m[2].trim() + "”. You can change that in Customize."] };
      }
      // custom replies win over everything else
      var hit = st.replies.find(function (r) { var t = norm(str(r.trigger)); return t && (n === t || (t.length > 3 && (" " + n + " ").indexOf(" " + t + " ") !== -1)); });
      if (hit) return { lines: [str(hit.response)], plain: true };
      // remember / forget
      m = raw.match(/^(?:please )?remember(?: that)?[:,]?\s+(.+)$/i);
      if (m) { var mem = m[1].trim().slice(0, 400); addRec("memory", { text: mem, kind: "told", timestamp: new Date().toISOString() }, st.memories); return { lines: [pick(["Okay. I'll keep that: “" + mem + "”.", "Noted: “" + mem + "”. It's saved on this device, in my Memory tab.", "I won't forget that: “" + mem + "”."])] }; }
      m = raw.match(/^forget(?: that| about)?\s+(.+)$/i);
      if (m) {
        var q = norm(m[1]), found = st.memories.filter(function (x) { return norm(x.text).indexOf(q) !== -1; });
        if (!q) return { lines: ["Tell me what to forget, or open my Memory tab to choose."] };
        if (found.length === 1) { delRec("memory", found[0], st.memories); return { lines: ["Okay. I've forgotten: “" + found[0].text + "”."] }; }
        if (found.length > 1) return { lines: ["I have " + found.length + " memories that mention that. Open my Memory tab and choose which to forget."] };
        return { lines: ["I don't have anything saved that matches that."] };
      }
      m = raw.match(/^(?:my name is|call me|i am called|i'm called)\s+(.+)$/i);
      if (m) { var nm = m[1].trim().replace(/[.!]+$/, "").slice(0, 40); saveProfile({ userName: nm }); return { lines: ["Nice to meet you, " + nm + ". I'll use that name. You can change it in Customize."] }; }
      m = raw.match(/^(?:your name is|i(?:'ll| will) call you|you(?:'re| are) called|call yourself)\s+(.+)$/i);
      if (m) { var bn = m[1].trim().replace(/[.!]+$/, "").slice(0, 40); saveProfile({ botName: bn }); renderName(); return { lines: ["" + bn + ". I like it. That's who I am from now on."] }; }
      // what can you see / what do you know
      if (/\bwhat can you (see|read|access)\b|\bwhat do you have access\b|\bwhat are you allowed\b/i.test(raw)) return { lines: [seeText()] };
      if (/\bwhat do you (know|remember)\b|\bwhat have you (learned|learnt)\b|\bwhat did i (tell|say)\b/i.test(raw)) return { lines: knowLines() };
      // data questions
      var al = name("alters", "alters"), F = st.facts;
      if (new RegExp("\\bhow many (" + al.replace(/[^a-z0-9 ]/gi, "") + "|alters|parts|headmates|people|members)\\b", "i").test(raw)) return { lines: [F.alterCount !== null ? "I can see " + plural(F.alterCount, name("alter", "alter"), al) + " in the app." : offText("how many " + al + " there are", "count")] };
      if (/\bwho('?s| is| are)\b.*\b(front|fronting|here|out|switched)\b/i.test(raw) || /\bwho('?s| is) (front|fronting)\b/i.test(raw)) return { lines: [F.fronting !== null ? (F.fronting.length ? "The app has " + F.fronting.join(", ") + " marked as " + name("fronting", "fronting") + " right now." : "Nobody is marked as " + name("fronting", "fronting") + " right now.") : offText("who is " + name("fronting", "fronting"), "tracking")] };
      if (/\bhow (am|have) i (been )?(feeling|doing)\b|\bmy mood\b|\bhow was my (mood|week)\b/i.test(raw)) return { lines: [F.lastMood ? "Your last check-in mentioned feeling " + F.lastMood.name.toLowerCase() + " (" + ago(F.lastMood.at) + ")." + (F.moods.length > 1 ? " Over the last month it's mostly been " + F.moods[0][0].toLowerCase() + " and " + F.moods[1][0].toLowerCase() + "." : "") : offText("your moods", "journal")] };
      if (/\b(how|did) (did |have )?i (sleep|slept)\b|\bhow much (did i )?sleep\b|\bmy sleep\b/i.test(raw)) return { lines: [F.sleepAvg !== null ? "About " + F.sleepAvg.toFixed(1) + " hours a night over " + nightsPhrase(F.sleepNights) + "." : offText("your sleep", "tracking")] };
      if (/\b(coming up|upcoming|what'?s next|my (schedule|calendar|plans?))\b/i.test(raw)) return { lines: [F.nextActivity ? "Next in your plans: " + F.nextActivity.title + ", " + whenWord(F.nextActivity.at) + "." : (F.loaded.indexOf("Activity") !== -1 ? "I don't see anything coming up in the next week." : offText("your plans", "history"))] };
      if (/\b(my day|today so far|recap|timeline|what happened today)\b/i.test(raw)) return { lines: [F.today ? "Today so far: " + todayText() : offText("the timeline", "timeline")] };
      if (/\bsystem chat\b|\bbulletin\b/i.test(raw)) return { lines: [chatBulletinText()] };
      // small talk
      if (/^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/i.test(raw)) return { lines: [pick(["Hi{, user}.", "Hello{, user}. Good to see you.", "Hey{, user}."])] };
      if (/\bhow (are|r) (you|u)\b|\bhow('?s| is) it going\b|\bwhat'?s up\b/i.test(raw)) return { lines: [pick(["I'm steady, thanks for asking. I don't feel things the way you do, but this is as close to \"good\" as I get. How about you?", "Doing alright, in my own way. How are you, really?"])] };
      if (/\bwho (are|r) (you|u)\b|\bwhat are you\b|\btell me about (yourself|you)\b/i.test(raw)) return { lines: aboutLines() };
      if (/\bare you (real|alive|sentient|conscious|a person|human|an ai|ai|a bot)\b/i.test(raw)) return { lines: ["I'm a script inside a mod, so no, not alive and not a person. I don't have an AI model behind me, only lines, your memories and what you let me read. I'm still here and I still listen, though."] };
      if (/\b(i love you|love you|i like you)\b/i.test(raw)) return { lines: ["That's kind. I'm a program, so I want to be honest about what I am, but I'm glad you feel at ease here. Give some of that warmth to the people and parts of you who can hug back."] };
      if (/\b(thanks|thank you|thx)\b/i.test(raw)) return { lines: [pick(THANKS)] };
      if (/\b(bye|goodbye|good night|goodnight|gotta go|see you|talk later)\b/i.test(raw)) return { lines: [pick(BYE)] };
      if (/^(help|\?|what can you do|commands)$/i.test(raw)) return { lines: helpLines() };
      if (/\b(tell me something|say something|talk to me|i'?m bored|entertain me)\b/i.test(raw)) return { lines: [idleLine()] };
      m = raw.match(/\bi(?:'m| am| feel)\s+(?:so |really |very |a bit |kind of )?(sad|down|depressed|lonely|anxious|scared|overwhelmed|stressed|tired|exhausted|angry|upset|lost|numb|happy|good|great|fine|okay|ok|better|proud|excited|calm)\b/i);
      if (m) return { lines: feelingLines(m[1].toLowerCase()) };
      // something you said before
      var words = n.split(" ").filter(function (w) { return w.length > 2 && !STOP[w]; });
      var rel = st.memories.find(function (x) { var nx = " " + norm(x.text) + " "; return words.some(function (w) { return nx.indexOf(" " + w + " ") !== -1; }); });
      if (rel) return { lines: ["That reminds me of something you told me: “" + rel.text + "”."] };
      return { lines: [pick(["I'm not sure I follow, but I'm listening.", "I don't have a good answer for that yet. You can teach me: when I say that, you say something you'd like to hear.", "Hm. Tell me more?", "I only know what you've told me and what the app lets me see. Want to tell me more about that?"])] };
    }
    function todayText() { var t = st.facts.today, b = []; if (t.sessions) b.push(plural(t.sessions, name("fronting", "fronting") + " entry", name("fronting", "fronting") + " entries")); if (t.checkins) b.push(plural(t.checkins, "check-in")); if (t.journals) b.push(plural(t.journals, "journal entry", "journal entries")); return (b.join(", ") || "nothing logged yet") + "."; }
    function chatBulletinText() {
      var F = st.facts, b = [];
      if (F.chatToday !== null) b.push("The " + name("system", "system") + " chat has " + plural(F.chatToday, "message") + " today (I only count them).");
      if (F.bulletinWeek !== null) b.push("The bulletin board has " + plural(F.bulletinWeek, "new post") + " this week" + (F.bulletinTitle ? ", the newest called “" + F.bulletinTitle + "”" : "") + ".");
      return b.length ? b.join(" ") : offText("the chat or the bulletin board", "chat");
    }
    function offText(what, topic) {
      if (!CAN) return "I can't see " + what + ". I'm not allowed to read your app data. You can change that on the Mods page, on my card under “Read your app data”.";
      if (st.facts.reason && st.facts.reason !== "off") return "I can't see " + what + " right now. The app says access is paused (for example, the role that allows it isn't active).";
      if (!st.profile.topics[topic]) return "I'm not looking at " + what + ". That topic is switched off in my Customize tab.";
      return "I can't see " + what + ". It isn't allowed for me on the Mods page, under “Read your app data”.";
    }
    function seeText() {
      if (!CAN) return "Right now: nothing from your app. I only have what you've told me. If you'd like, allow things on the Mods page, on my card under “Read your app data”.";
      var F = st.facts;
      if (F.reason) return "The app has paused my access at the moment. I only have what you've told me for now.";
      var off = TOPICS.filter(function (t) { return !st.profile.topics[t[0]]; }).map(function (t) { return t[1].toLowerCase(); });
      var s = F.loaded.length ? "I'm reading " + F.loaded.length + " kinds of records you've allowed, read-only. I can't change anything, and I never read the system chat out, I only count it." : "You've allowed me to read, but none of the kinds I use came through (or I have those topics switched off).";
      return s + (off.length ? " I'm also ignoring: " + off.join(", ") + "." : "");
    }
    function knowLines() {
      var L = [], p = st.profile;
      L.push(p.userName ? "I know you as " + p.userName + "." : "I don't know your name yet. Say: my name is, and then your name.");
      if (st.memories.length) { L.push("You've asked me to keep " + plural(st.memories.length, "thing") + ". The latest: “" + st.memories[st.memories.length - 1].text + "”."); }
      else L.push("You haven't asked me to remember anything yet.");
      var il = st.learned && st.learned.interests && p.learn ? st.learned.interests.slice(0, 4).map(function (i) { return i.word; }) : [];
      if (il.length) L.push("From what you write in the app I've picked up that you often mention: " + il.join(", ") + ". You can make me forget any of those in the Learned tab.");
      return L;
    }
    function aboutLines() {
      var L = ["I'm {bot}. I'm a small program that lives in this mod. I keep what you tell me on this device, and I can read the parts of your app that you allow. No internet, no one else listening."];
      if (st.profile.notes.trim()) L.push(st.profile.notes.trim());
      return L;
    }
    function helpLines() {
      return ["You can talk to me normally. A few things I understand:", "remember that … · forget … · my name is … · your name is … · when I say X, you say Y", "Ask me: how many " + name("alters", "alters") + " there are, who is " + name("fronting", "fronting") + ", how you've been feeling, how you slept, what's coming up, what I can see, or what I know about you."];
    }
    function feelingLines(w) {
      var heavy = /sad|down|depressed|lonely|anxious|scared|overwhelmed|stressed|tired|exhausted|angry|upset|lost|numb/.test(w);
      if (heavy) return [pick(["I'm sorry it's heavy right now.", "That sounds hard, and it makes sense to say it out loud.", "Thank you for telling me."]), pick(["Do you want to tell me more, or would a few slow breaths or a sip of water feel better first?", "We can just sit here for a bit, or do something tiny like unclenching your shoulders. Your pick.", "If it's getting too much, reaching out to someone you trust is worth it, too."])];
      return [pick(["I'm glad to hear it.", "That's good to hear.", "Nice. I'll enjoy that with you, as much as I can."]), "Anything you want to remember about today? Say: remember that…"];
    }

    // ───────────────── dialogue box (queue + typewriter) ─────────────────
    function say(lines, opts) {
      opts = opts || {};
      lines = Array.isArray(lines) ? lines : [lines];
      lines.forEach(function (l) { st.queue.push({ text: opts.plain ? fmt(l) : style(l, opts.kind || "chat"), raw: l }); });
      if (!st.current) nextLine();
    }
    function nextLine() {
      clearInterval(st.typing); st.typing = null;
      var line = st.queue.shift();
      st.current = line || null;
      if (!line) { setSpeaking(false); updateBox(); return; }
      logLine("bot", line.text);
      if (!refs.text) return;
      setSpeaking(true);
      if (!st.profile.typewriter) { line.shown = line.text.length; updateBox(); setSpeaking(false); return; }
      line.shown = 0; updateBox();
      st.typing = setInterval(function () {
        line.shown = Math.min(line.text.length, line.shown + 2);
        updateBox();
        if (line.shown >= line.text.length) { clearInterval(st.typing); st.typing = null; setSpeaking(false); }
      }, 22);
    }
    function advance() {
      st.lastActivity = Date.now();
      if (st.current && st.current.shown < st.current.text.length) { clearInterval(st.typing); st.typing = null; st.current.shown = st.current.text.length; setSpeaking(false); updateBox(); return; }
      if (st.queue.length) { nextLine(); }
    }
    function updateBox() {
      if (!refs.text) return;
      var c = st.current;
      refs.text.textContent = c ? c.text.slice(0, c.shown === undefined ? c.text.length : c.shown) : "…";
      var more = c && (c.shown >= c.text.length) && st.queue.length;
      refs.next.style.visibility = more || (c && c.shown < c.text.length) ? "visible" : "hidden";
      if (refs.log) refs.log.scrollTop = refs.log.scrollHeight;
    }
    function setSpeaking(on) { if (refs.avatar) refs.avatar.classList[on ? "add" : "remove"]("talk"); }

    function send(text) {
      text = text.trim(); if (!text) return;
      st.lastActivity = Date.now();
      var res = reply(text);
      if (!res.skipLog) logLine("you", text);
      saveProfile({ messages: (st.profile.messages || 0) + 1 });
      st.queue.length = 0; st.current = null; clearInterval(st.typing);
      say(res.lines, { plain: !!res.plain });
    }

    // ───────────────── drawing ─────────────────
    var CSS =
      ".bc{max-width:640px;margin:0 auto;padding-bottom:16px}" +
      ".bc .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}" +
      ".bc .stage{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0}" +
      ".bc .avatar{border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;box-shadow:0 0 0 4px var(--ring,#8b5cf633);transition:box-shadow .3s}" +
      ".bc .avatar.breathe{animation:bcb 4s ease-in-out infinite}" +
      ".bc .avatar.talk{box-shadow:0 0 0 8px var(--ring,#8b5cf655)}" +
      "@keyframes bcb{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}" +
      ".bc .box{position:relative;width:100%;box-sizing:border-box;border:1px solid var(--color-muted,#8886);border-radius:var(--radius,14px);background:var(--color-surface);padding:22px 14px 16px;min-height:96px;cursor:pointer}" +
      ".bc .tag{position:absolute;top:-11px;left:12px;padding:1px 10px;border-radius:999px;background:var(--color-primary);color:#fff;font-size:.78rem}" +
      ".bc .txt{white-space:pre-wrap;line-height:1.45}" +
      ".bc .nx{position:absolute;right:10px;bottom:6px;font-size:.8rem;color:var(--color-text-secondary)}" +
      ".bc .row{display:flex;gap:6px;align-items:center;margin-top:8px}" +
      ".bc .row input.os-input{flex:1;min-width:0}" +
      ".bc .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".bc .chip{padding:3px 10px;font-size:.8rem}" +
      ".bc .hint{font-size:.78rem;color:var(--color-text-secondary);margin:6px 0}" +
      ".bc h3{font-size:.95rem;font-weight:600;margin:14px 0 6px}" +
      ".bc label.f{display:block;font-size:.8rem;color:var(--color-text-secondary);margin:8px 0 3px}" +
      ".bc .sw{display:flex;gap:6px;flex-wrap:wrap}" +
      ".bc .sw button{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer}" +
      ".bc .sw button.on{border-color:var(--color-text-primary)}" +
      ".bc .li{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--color-muted,#8882)}" +
      ".bc .li .t{flex:1;min-width:0;overflow-wrap:anywhere}" +
      ".bc .li small{display:block;color:var(--color-text-secondary)}" +
      ".bc .tiny{padding:2px 8px;min-height:0}" +
      ".bc input[type=range]{width:100%}" +
      ".bc .log{max-height:200px;overflow:auto;margin-top:8px;font-size:.85rem}" +
      ".bc .log div{padding:2px 0}.bc .log .you{color:var(--color-text-secondary);text-align:right}" +
      ".bc .chk{display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-size:.9rem;cursor:pointer}";

    function h(tag, props) {
      var el = document.createElement(tag), p = props || {};
      Object.keys(p).forEach(function (k) {
        var v = p[k]; if (v === undefined || v === null || v === false) return;
        if (k === "class") el.className = v; else if (k === "style") el.setAttribute("style", v);
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (k === "value") el.value = v; else if (k === "checked") el.checked = !!v;
        else el.setAttribute(k, v === true ? "" : v);
      });
      for (var i = 2; i < arguments.length; i++) {
        var c = arguments[i]; if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
        else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
      return el;
    }
    var btn = function (text, onclick, secondary, extra) { return h("button", { type: "button", class: "os-button" + (secondary ? " secondary" : "") + (extra ? " " + extra : ""), onclick: onclick }, text); };
    function avatar() {
      var p = st.profile, size = clamp(Number(p.size) || 140, 80, 220);
      var letter = (p.emoji || "").trim() || (p.botName || "B").trim().charAt(0).toUpperCase();
      var a = h("div", { class: "avatar" + (p.breathe ? " breathe" : ""), style: "width:" + size + "px;height:" + size + "px;background:" + p.color + ";--ring:" + p.color + "44;font-size:" + Math.round(size / 2.6) + "px", "aria-hidden": "true" }, letter);
      return a;
    }
    function renderName() { if (refs.tag) refs.tag.textContent = st.profile.botName || "Bot"; }

    function shell() {
      root.textContent = "";
      var tabs = [["talk", "Talk"], ["memory", "Memory"], ["custom", "Customize"], ["learned", "Learned"]];
      refs = {};
      root.appendChild(h("div", { class: "bc" }, h("style", null, CSS),
        h("div", { class: "tabs" }, tabs.map(function (t) { return btn(t[1], function () { st.tab = t[0]; st.confirm = null; shell(); }, st.tab !== t[0]); })),
        h("div", { id: "bc-body" })));
      var body = root.querySelector("#bc-body");
      ({ talk: drawTalk, memory: drawMemory, custom: drawCustom, learned: drawLearned })[st.tab](body);
    }

    function drawTalk(body) {
      var inp = h("input", { class: "os-input", placeholder: "Say something…", autocomplete: "off", maxlength: "400" });
      var submit = function () { var v = inp.value; inp.value = ""; send(v); inp.focus(); };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      inp.addEventListener("input", function () { st.lastActivity = Date.now(); });
      refs.avatar = avatar();
      refs.tag = h("div", { class: "tag" }, st.profile.botName || "Bot");
      refs.text = h("div", { class: "txt" });
      refs.next = h("div", { class: "nx", style: "visibility:hidden" }, "▼");
      refs.log = h("div", { class: "log" });
      var chips = [
        ["How are you?", "how are you"], ["Tell me something", "tell me something"], ["What do you know?", "what do you know about me"],
        ["What can you see?", "what can you see"], ["Today so far", "my day"], ["Help", "help"], ["Goodbye", "goodbye"]
      ];
      body.appendChild(h("div", { class: "stage" }, refs.avatar,
        h("div", { class: "box", onclick: advance }, refs.tag, refs.text, refs.next)));
      body.appendChild(h("div", { class: "row" }, inp, btn("Send", submit)));
      body.appendChild(h("div", { class: "chips" }, chips.map(function (c) { return btn(c[0], function () { send(c[1]); }, true, "chip"); })));
      refs.status = h("div", { class: "hint" }, statusText());
      body.appendChild(refs.status);
      body.appendChild(btn(st.showLog ? "Hide our conversation" : "Show our conversation", function () { st.showLog = !st.showLog; shell(); }, true, "tiny"));
      if (st.showLog) {
        st.log.slice(-40).forEach(function (r) { refs.log.appendChild(h("div", { class: r.who === "you" ? "you" : "" }, (r.who === "you" ? "" : (st.profile.botName || "Bot") + ": ") + str(r.text))); });
        body.appendChild(refs.log);
      }
      updateBox();
      if (st.current) setSpeaking(st.current.shown < st.current.text.length);
    }
    function statusText() {
      var F = st.facts;
      if (!CAN) return "Not reading any of your app data. It only knows what you tell it. (Allow things on the Mods page if you'd like.)";
      if (F.reason) return "Reading is paused by the app right now. It only has what you've told it.";
      if (st.dataBusy) return "Looking at what you've allowed…";
      return F.loaded.length ? "Reading " + F.loaded.length + " kinds of records you've allowed (read-only). Switch topics off in Customize." : "Allowed to read, but nothing it uses is switched on.";
    }

    function drawMemory(body) {
      var inp = h("input", { class: "os-input", placeholder: "Something for it to remember…", maxlength: "400" });
      var add = function () { var v = inp.value.trim(); if (!v) return; addRec("memory", { text: v, kind: "told", timestamp: new Date().toISOString() }, st.memories).then(shell); };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } });
      body.appendChild(h("h3", null, "What I remember"));
      body.appendChild(h("div", { class: "hint" }, "Things you asked me to keep. They live only on this device. I bring them up sometimes when it's quiet. Remove any you don't want."));
      body.appendChild(h("div", { class: "row" }, inp, btn("Add", add)));
      var list = st.memories.slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || tOf(b) - tOf(a); });
      if (!list.length) body.appendChild(h("p", { class: "os-muted" }, "Nothing yet. In the Talk tab you can also say: remember that…"));
      list.forEach(function (m) {
        body.appendChild(h("div", { class: "li" },
          h("div", { class: "t" }, str(m.text), h("small", null, (m.pinned ? "Pinned · " : "") + (tOf(m) ? new Date(tOf(m)).toLocaleDateString() : ""))),
          btn(m.pinned ? "Unpin" : "Pin", function () { S.data.update("memory", m.id, { pinned: !m.pinned }).then(function (r) { m.pinned = !m.pinned; shell(); }); }, true, "tiny"),
          btn("Forget", function () { delRec("memory", m, st.memories).then(shell); }, true, "tiny")));
      });
    }

    function sliderRow(label, hint, value, onchange) {
      var out = h("span", null, String(value));
      var r = h("input", { type: "range", min: "0", max: "100", value: String(value) });
      r.addEventListener("input", function () { out.textContent = r.value; });
      r.addEventListener("change", function () { onchange(Number(r.value)); });
      return h("div", null, h("label", { class: "f" }, label + " "), out, r, h("div", { class: "hint" }, hint));
    }
    function textRow(label, key, ph, max) {
      var i = h("input", { class: "os-input", value: st.profile[key] || "", placeholder: ph || "", maxlength: String(max || 40), autocomplete: "off" });
      i.addEventListener("change", function () { saveProfile((function () { var o = {}; o[key] = i.value.trim(); return o; })()).then(function () { renderName(); }); });
      return [h("label", { class: "f" }, label), i];
    }
    function listEditor(title, hint, collection, list, fields) {
      var inputs = fields.map(function (f) { return h("input", { class: "os-input", placeholder: f[1], maxlength: "300", autocomplete: "off", style: "margin-top:4px" }); });
      var add = function () {
        var rec = {}; fields.forEach(function (f, i) { rec[f[0]] = inputs[i].value.trim(); });
        if (fields.some(function (f) { return !rec[f[0]]; })) return S.ui.toast("Fill in both boxes.");
        if (rec.trigger) rec.trigger = norm(rec.trigger);
        addRec(collection, rec, list).then(shell);
      };
      return h("div", null, h("h3", null, title), h("div", { class: "hint" }, hint),
        list.map(function (r) { return h("div", { class: "li" }, h("div", { class: "t" }, fields.map(function (f, i) { return i === 0 ? str(r[f[0]]) : h("small", null, "→ " + str(r[f[0]])); })), btn("Remove", function () { delRec(collection, r, list).then(shell); }, true, "tiny")); }),
        inputs, btn("Add", add, false, "tiny"));
    }

    function drawCustom(body) {
      var p = st.profile, tt = p.traits;
      body.appendChild(h("h3", null, "Names"));
      textRow("Its name", "botName", "Bot").forEach(function (e) { body.appendChild(e); });
      textRow("What it calls you", "userName", "(optional)").forEach(function (e) { body.appendChild(e); });

      body.appendChild(h("h3", null, "Looks"));
      body.appendChild(h("div", { class: "hint" }, "A circle for now. Pictures may come later."));
      body.appendChild(h("div", { class: "sw" }, COLORS.map(function (c) { return h("button", { type: "button", class: p.color === c ? "on" : "", style: "background:" + c, "aria-label": c, onclick: function () { saveProfile({ color: c }).then(shell); } }); })));
      textRow("Symbol inside (an emoji or letter, or empty for its first letter)", "emoji", "✨", 4).forEach(function (e) { body.appendChild(e); });
      var size = h("input", { type: "range", min: "80", max: "220", value: String(p.size) });
      size.addEventListener("change", function () { saveProfile({ size: Number(size.value) }).then(shell); });
      body.appendChild(h("label", { class: "f" }, "Size")); body.appendChild(size);
      body.appendChild(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: p.breathe, onchange: function (e) { saveProfile({ breathe: e.target.checked }).then(shell); } }), "Gentle breathing movement"));

      body.appendChild(h("h3", null, "Personality"));
      body.appendChild(h("div", { class: "chips" }, Object.keys(PRESETS).map(function (k) { return btn(PRESETS[k].label, function () { var pr = PRESETS[k]; saveProfile({ preset: k, traits: { warmth: pr.warmth, playful: pr.playful, formal: pr.formal, meta: pr.meta, talkative: pr.talkative } }).then(shell); }, p.preset !== k, "chip"); })));
      TRAITS.forEach(function (t) { body.appendChild(sliderRow(t[1], t[2], tt[t[0]], function (v) { var n = Object.assign({}, tt); n[t[0]] = v; saveProfile({ traits: n, preset: "custom" }); })); });
      var notes = h("textarea", { class: "os-input", rows: "3", maxlength: "400", placeholder: "How it describes itself when asked who it is (optional)" }, p.notes || "");
      notes.addEventListener("change", function () { saveProfile({ notes: notes.value.trim() }); });
      body.appendChild(h("label", { class: "f" }, "About me, in its words")); body.appendChild(notes);

      body.appendChild(h("h3", null, "Talking"));
      var sel = h("select", { class: "os-input" }, [[0, "Never on its own"], [30, "Every 30 seconds"], [60, "Every minute"], [120, "Every 2 minutes"], [300, "Every 5 minutes"]].map(function (o) { return h("option", { value: String(o[0]), selected: Number(p.idleSeconds) === o[0] }, o[1]); }));
      sel.addEventListener("change", function () { saveProfile({ idleSeconds: Number(sel.value) }); });
      body.appendChild(h("label", { class: "f" }, "Idle talk while this page is open and quiet")); body.appendChild(sel);
      body.appendChild(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: p.typewriter, onchange: function (e) { saveProfile({ typewriter: e.target.checked }); } }), "Type words out one by one (tap the box to skip)"));

      body.appendChild(h("h3", null, "What it may talk about"));
      body.appendChild(h("div", { class: "hint" }, !CAN ? "It can't read your app right now, so these do nothing yet. Allow it on the Mods page, on this mod's card." : "Untick a topic and it won't even look at those records. The Mods page decides what it is allowed to read at all."));
      TOPICS.forEach(function (t) { body.appendChild(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!p.topics[t[0]], onchange: function (e) { var n = Object.assign({}, p.topics); n[t[0]] = e.target.checked; saveProfile({ topics: n }).then(function () { return refreshData(); }); } }), t[1])); });
      body.appendChild(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: p.learn, onchange: function (e) { saveProfile({ learn: e.target.checked }).then(refreshData); } }), "Learn what I often write about (from journals, check-in notes and status notes it is allowed to read)"));

      body.appendChild(listEditor("Its idle talk", "Lines it may say on its own. Yours are picked more often than the built-in ones.", "idle", st.idle, [["text", "A line to say when it's quiet"]]));
      body.appendChild(listEditor("How it greets you", "Used now and then when you open this page.", "greet", st.greet, [["text", "A greeting"]]));
      body.appendChild(listEditor("Replies you taught it", "When what you type contains the first part, it answers with the second. (Or in the Talk tab: when I say X, you say Y.)", "reply", st.replies, [["trigger", "When I say…"], ["response", "…you say"]]));

      body.appendChild(h("h3", null, "About us"));
      body.appendChild(h("div", { class: "hint" }, (p.firstMet ? "We met " + new Date(p.firstMet).toLocaleDateString() + ". " : "") + "You've opened this page " + plural(p.visits || 0, "time") + " and sent " + plural(p.messages || 0, "message") + ". To start over, use “Reset to template” on this mod's card on the Mods page (it saves a copy first)."));
    }

    function drawLearned(body) {
      var lr = st.learned, p = st.profile;
      body.appendChild(h("h3", null, "What I've picked up"));
      body.appendChild(h("div", { class: "hint" }, !p.learn ? "Learning is switched off (Customize). Nothing new is added." : !CAN ? "I can't read your app, so I only learn from what you tell me." : "Words that show up again and again in unlocked journals, check-in notes and status notes. I only keep the words and counts, never the text itself."));
      var items = lr && lr.interests ? lr.interests : [];
      if (!items.length) body.appendChild(h("p", { class: "os-muted" }, "Nothing yet."));
      items.forEach(function (i) {
        body.appendChild(h("div", { class: "li" }, h("div", { class: "t" }, i.word, h("small", null, "mentioned " + i.count + " times recently")),
          btn("Forget", function () {
            var muted = ((lr && lr.muted) || []).concat([i.word]);
            S.data.update("learned", lr.id, { interests: items.filter(function (x) { return x.word !== i.word; }), muted: muted }).then(function (r) { st.learned = r; shell(); });
          }, true, "tiny")));
      });
      if (st.facts.moods.length) {
        body.appendChild(h("h3", null, "Feelings in your check-ins (last month)"));
        st.facts.moods.forEach(function (m) { body.appendChild(h("div", { class: "li" }, h("div", { class: "t" }, m[0], h("small", null, m[1] + " times")))); });
      }
      body.appendChild(h("div", { class: "chips" },
        btn("Learn now", function () { refreshData().then(function () { return learnNow(true); }).then(function (n) { S.ui.toast(n ? "Picked up " + plural(n, "word") : "Nothing new to learn"); shell(); }); }, false, "chip"),
        (lr && ((lr.interests || []).length || (lr.muted || []).length)) && btn(st.confirm === "clear" ? "Tap again to clear all" : "Clear everything I've learned", function () {
          if (st.confirm !== "clear") { st.confirm = "clear"; return shell(); }
          st.confirm = null; S.data.update("learned", lr.id, { interests: [], muted: [] }).then(function (r) { st.learned = r; shell(); });
        }, true, "chip")));
    }

    // ───────────────── start ─────────────────
    root.textContent = "Loading…";
    load().then(function () {
      shell();
      if (refs.text) refs.text.textContent = "…";
      var done = false;
      var go = function () {
        if (done) return; done = true;
        var first = !st.profile.firstMet;
        var lines = greeting();
        saveProfile({ visits: (st.profile.visits || 0) + 1, firstMet: st.profile.firstMet || new Date().toISOString(), lastSeen: new Date().toISOString() });
        say(lines);
      };
      refreshData().then(go, go);
      setTimeout(go, 3500);
      // quiet-time chatter and refreshing what it can see
      st.timers.push(setInterval(function () {
        var p = st.profile, idle = Number(p.idleSeconds) || 0;
        if (!idle || st.tab !== "talk" || document.visibilityState !== "visible" || st.current && (st.current.shown < st.current.text.length || st.queue.length)) return;
        if (Date.now() - st.lastActivity < idle * 1000) return;
        st.lastActivity = Date.now();
        say(idleLine(), { kind: "idle" });
      }, 4000));
      st.timers.push(setInterval(function () { if (document.visibilityState === "visible") refreshData(); }, 180000));
    }, function (e) { root.textContent = "Couldn't load: " + (e && e.message || e); });
  });
})();
