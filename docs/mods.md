# Making mods for Oceans Symphony

A mod adds a feature to Oceans Symphony without changing the app itself.
You write it, pack it into one `.osmod` file, and share that file. Anyone
can install it from **Mods → Install**, keep using the normal app with its
updates, and switch the mod off or remove it whenever they like.

The example in [`mods/examples/little-notes`](../mods/examples/little-notes)
is a complete mod in about 60 lines. Start by copying it.

## What a mod is

A folder with two files:

```
my-mod/
  manifest.json   who you are, what you add, what you need to see
  main.js         your code (one file; bundle it first if you use npm packages)
```

Pack it into a shareable file:

```
node scripts/pack-mod.mjs path/to/my-mod
# → path/to/my-mod/my-mod-1.0.0.osmod
```

The `.osmod` file is plain JSON: the manifest with your code in a `code` field.

### manifest.json

```json
{
  "id": "twin-notes",
  "name": "Twin notes",
  "version": "1.0.0",
  "author": "Your name",
  "description": "One or two sentences people see before installing.",
  "homepage": "https://example.com/twin-notes",
  "permissions": ["alters:read"],
  "pages": [
    { "id": "notes", "title": "Twin notes" },
    { "id": "settings", "title": "Twin notes settings" }
  ]
}
```

- `id`: lowercase letters, numbers and dashes. It's the mod's identity: a file
  with the same `id` installs as an **update**, and the mod's saved data is
  tied to it. Never change it after you've shared the mod.
- `pages`: up to 12. Each page appears in the app's navigation (people can
  pin it to their bars or dashboard like any other page).
- `permissions`: only what you need. People see each one in plain words and
  can say no; your mod must still work (show a message) when one is missing.
- `homepage`: optional, `https://` only. Shown as an "About" link.

## The `symphony` API

Your code runs with one global, `symphony`. Every call that touches data
returns a Promise.

### Pages

```js
symphony.registerPage("notes", async (root, symphony) => {
  root.textContent = "Hello!";
});
```

Each page opens in its own frame, runs your whole `main.js`, then calls the
renderer for that page id with an empty `root` element. Draw with plain DOM,
or bundle a small framework (Preact, Lit…) into `main.js`. The frame grows to
fit your content.

### Your own data

```js
const note = await symphony.data.create("note", { text: "hi", pinned: false });
await symphony.data.update("note", note.id, { pinned: true });
const all = await symphony.data.list("note");              // oldest first
const pinned = await symphony.data.list("note", { pinned: true }); // simple equality filter
const one = await symphony.data.get("note", note.id);      // or null
await symphony.data.remove("note", note.id);
symphony.onDataChange((change) => redraw());               // any change to your data, from anywhere
```

- Collections are names you choose (letters, numbers, `-`, `_`).
- Records are plain JSON objects, up to 256 KB and 100 fields. Field names are
  letters, numbers and `_`, starting with a letter. `id`, `created_date` and
  `updated_date` are set by the app.
- Your data is stored with everything else: encrypted if the person uses
  encryption, included in their backups, synced between their devices, and
  removed records can be restored from Recent changes. It is **kept** when
  the mod is removed, and comes back if it's installed again.

### The person's words and colours

```js
symphony.terms.alter     // "alter", or whatever they call alters
symphony.terms.Alters    // capitalised plural
symphony.terms.fronting, symphony.terms.system, symphony.terms.switch …
symphony.theme           // reserved
```

Always use `symphony.terms` instead of writing "alter", "system", "front" or
"switch" yourself. People customise these words and it matters to them.

The app's colours arrive as CSS variables (`--color-bg`, `--color-surface`,
`--color-primary`, `--color-text-primary`, `--color-text-secondary`,
`--color-muted`, `--radius`, `--font-sans`). A few ready-made classes use
them: `os-card`, `os-button` (add `secondary` for an outline button),
`os-input`, `os-row`, `os-muted`.

### Reading the person's data (needs permission)

| Permission | Call | You get |
|---|---|---|
| `alters:read` | `symphony.alters.list()` | `[{ id, name, alias, pronouns, role, color, archived }]` |
| `fronting:read` | `symphony.fronting.current()` | `[{ alter_id, is_primary, since }]` |
| `data:read` | `symphony.appData.list(entity, { offset, limit })` | See below: password + role gated, read-only |
| `files:save` | `symphony.ui.saveFile(name, blob, mime)` | Saves a file the person asked for (export, attachment) through the app's save/share sheet; resolves to `"downloaded"`, `"shared"`, `"cancelled"` or `"failed"` |
| `apps:launch` | `symphony.ui.openApp(packageName)`, `symphony.ui.openLink(url)`, `symphony.apps.isInstalled(packageName)` | Opens an app, opens a link, or checks whether one app is installed (see below) |

### Opening apps and links (`apps:launch`)

```js
const installed = await symphony.apps.isInstalled("com.spotify.music"); // true | false | null
const result = await symphony.ui.openApp("com.spotify.music");
// "opened" | "not-installed" | "unsupported" | "failed"
if (result === "not-installed") {
  // Offer the link instead, on a tap:
  await symphony.ui.openLink("https://play.google.com/store/apps/details?id=com.spotify.music");
}
```

- `openApp` starts the app's normal launch screen, like tapping its icon. It
  can't open a particular screen inside an app or pass it anything. The name
  must look like `com.example.app`.
- `isInstalled` answers for the one name you ask about. There is no way to list
  what's installed. It returns `null` where the device can't say (the web
  build, desktop, iOS); treat that as "unknown" and show the link.
- `openLink` opens `https://` links only, in the in-app browser.
- Call them from a tap, not on page load. They only work while the app is on
  screen, and a mod can start at most one thing every 1.5 seconds.
- Android only for `openApp` and `isInstalled`. Check `symphony.permissions`
  first and show a friendly message when it was turned off.

### Reading app data (`data:read`, heavy permission)

```json
"permissions": ["data:read"],
"dataScopes": ["JournalEntry", "EmotionCheckIn"]
```

```js
await symphony.appData.collections();                      // the kinds of records you were allowed
const { total, records } = await symphony.appData.list("JournalEntry", { offset: 0, limit: 100 });
const { total: all, active } = await symphony.appData.count("Alter");  // just how many, no content
```

`data:read` is never a plain tick. The person must set a **mod access
password** (Settings → Storage & encryption → Mod data access) and then
allow your mod on the Mods page by typing it, **while an alter with an allowed
role (default "Gatekeeper") is fronting**. The role check runs again on every
call, so reads stop when no allowed role is active, when the mod is switched
off, or when the person turns mod data access off. Rules:

- Read-only copies, at most 500 records per call. `dataScopes` lists the
  kinds you want: `Alter`, `FrontingSession`, `JournalEntry`, `EmotionCheckIn`,
  `SymptomCheckIn`, `Activity`, `Task`, `StatusNote`, `Location`, `Sleep`,
  `SystemChangeEvent`, `Group`, `AlterNote`, `SystemChatChannel`,
  `SystemChatMessage`, `Bulletin`, `BulletinComment`. Anything else is
  unreachable.
- **Count-only scopes:** `"count:Alter"` (or `count:` plus any kind above)
  lets you call `appData.count(kind)` and get `{ total, active }` (`active`
  leaves out archived or deleted ones) without ever seeing a record. A full
  scope also allows `count`. `appData.collections()` returns the scopes as
  granted, including the `count:` ones, so skip those when you loop over kinds
  to list.
- System chat never includes **private channels** (anything marked private,
  whoever is fronting) or deleted messages. Treat chat as something to count
  or summarise carefully, not to read out.
- On the Mods page the person sees one tick, "All of the system data", and a
  "Choose what it can read" list grouped as: how many alters, who the alters
  are, history and calendar, journals and check-in log, tracking, system chat,
  bulletin board, timeline. Narrowing what you can read needs no password;
  widening needs the password and the allowed role. Handle any group being
  off.
- Fields that look like secrets (`_…`, `secret`, `token`, `password`, `key`,
  `recovery`, `endpoint`) are removed. Locked journal entries arrive still
  encrypted.
- Updating a mod that asks for more `dataScopes` than before resets the grant;
  the person must allow it again with the password.
- Handle the rejection: the person may have it off, or no allowed role is
  fronting right now. Show a friendly message.

`symphony.permissions` lists what was granted. A call without permission
rejects with an error; check first and show a friendly message.

More read permissions (journals, history, custom fields…) will be added over
time. Ask for what you need in the Oceans Symphony repo.

### Interface helpers

```js
symphony.ui.toast("Saved");         // the app's own toast
symphony.ui.openPage("settings");   // go to another page of your mod
symphony.mod                        // { id, name, version }
symphony.page                       // the page id being shown
```

## Starting data, and taking data with the mod

### `template`: the mod's starting state

A mod can ship starter records. Put them in `template.json` next to
`manifest.json` (or inline as `"template"` in the manifest):

```json
[
  { "collection": "shortcut", "name": "Spotify", "package": "com.spotify.music", "order": 1 },
  { "collection": "settings", "columns": 4 }
]
```

- Added when the mod is installed **fresh** and has no saved data (a reinstall
  after removing keeps the data it had, and an update never re-adds starter
  items someone deleted).
- On the Mods page, a mod with a template shows **Reset to template**. It
  saves a copy of the current data to the device first, removes it, and puts
  the template's records back. If the copy can't be saved, nothing changes.
  **Delete its data** (empties the mod, also after a copy) is a separate button.
- **Save as template** on the card makes the mod's current data the template
  instead. It is stored beside the mod's own template, which it never
  overwrites; **Use original template** (shown once you've saved one) goes back.
  A mod export carries whichever template is in use. A template can hold up to
  500 records.
- Same rules as any record: plain JSON, field names of letters, numbers and
  `_`, at most 100 fields and 256 KB each. Records that break the rules are
  left out. A template record may carry an `id` so others can point at it
  (ids are remapped when it is used, as with restored data below).

### Export data / Import data

Each mod's card has **Export data** and **Import data**.

- **Export data** has one tick, "Also include the mod itself". Unticked it
  writes a data-only file (`kind: "oceans-symphony-mod-data"`); ticked it writes
  a `.osmod` holding the mod, its template and a `data` block, which installs
  anywhere. A mod with nothing saved exports as just the mod. The data is
  readable (unless the mod encrypts it itself), and the dialog says so.
- **Import data** reads either kind of file (it must belong to this mod). For a
  `.osmod` there is a tick, "Also update the mod itself": unticked loads the
  data only; ticked also installs the file's code, keeping the permissions
  already granted (new ones stay off). You choose to *replace* the current data
  (a copy is saved first, and a failed copy changes nothing) or *add* to it. A
  confirmation spells out what will happen before anything is touched.
- Installing a with-data `.osmod` from the main Install button offers the same
  restore, ticked by default only when the mod has nothing saved yet.

```json
"data": { "exported_at": "2026-11-01T…", "records": [ { "id": "abc", "collection": "shortcut", "name": "…" } ] }
```

Restored records get new ids. If a field holds another record's old id (as a
string, or inside an array or object), it is rewritten to the new id, so links
between records survive. Anything else you use to connect records (your own
`key` field) is untouched.

## What mods can't do (on purpose)

People keep their whole system's history in this app, so mods are walled off:

- **No access to the app's storage.** Mods run in a sandboxed frame with its
  own empty origin; the browser itself stops it reading the app's database,
  settings or files.
- **No network.** `fetch`, XHR, WebSockets, WebRTC, remote images, fonts and
  scripts are all blocked. A mod can't send anything off the device. Bundle
  every asset into `main.js` (images as `data:` URLs).
- **No changing anything outside its own data.** Mods can read some core data
  with permission, but can't create, change or delete alters, fronts,
  journals or anything else the app owns.
- **No background running.** A mod's code only runs while one of its pages is
  open.
- No `localStorage`/`indexedDB` (use `symphony.data`), no popups, no
  navigating away (a mod frame that tries is stopped).

## Testing your mod

1. `node scripts/pack-mod.mjs my-mod`
2. In the app: **Mods → Install**, pick the `.osmod` file.
3. Change your code, pack again, install the same file again: it updates in
   place and keeps your test data.

Errors thrown by your code show up in the page frame. On the web build you
can also use the browser's dev tools; the frame's script is named
`mod-<id>.js`.

## Sharing

Share the `.osmod` file however you like. Tell people what it does and what
it asks to see. Oceans Symphony doesn't review mods, so people are told to
install only mods from people they trust. Be that person.

---

## How it works (for app contributors)

- `public/mod-host.html` + `public/mod-host.js`: the sandbox page. Loaded in
  `<iframe sandbox="allow-scripts">` (opaque origin). Its own CSP blocks all
  network; it refuses to run if Capacitor's native bridge is visible in the
  frame (old Android WebViews expose it to every frame).
- `src/lib/mods/broker.js`: answers every call; the only code that touches
  the database for a mod.
- `src/lib/mods/modPackage.js`: parses and checks `.osmod` files (including
  `template` and `data`), and lists the permissions.
- `src/lib/nativeAppLauncher.js` + `AppLauncherPlugin.java`: the Android side
  of `apps:launch` (launch screen of one named app, installed yes/no).
  `AndroidManifest.xml` has a `<queries>` block so Android 11+ lets it ask.
- `src/lib/mods/modAccess.js`: the mod access password, the allowed-role gate
  and the list of readable records for `data:read`. `modStore.grantDataAccess`
  is the only way the permission is given.
- `src/lib/mods/modStore.js`: `ModPackage` / `ModData` entities, install,
  remove, data export and delete (always saves a copy first).
- `src/lib/mods/registry.js`: puts mod pages into `ALL_PAGES`, the sidebar
  and the nav catalogue.
- `src/components/mods/ModFrame.jsx`, `src/pages/Mods.jsx`,
  `src/pages/ModPage.jsx`: the screens.
- The parent page's CSP `frame-src 'self' blob:` also blocks a mod frame from
  navigating to another site; `ModFrame` stops a frame that loads twice.
- On the web, `vercel.json` gives `/mod-host.html` its own headers (it must be
  frameable by the app, unlike every other page).

Known limits of the sandbox: it is the browser's, so it's strong, but a mod
is still code someone else wrote. The real protection is that a mod only ever
receives the data its permissions name. Keep new permissions narrow, and
describe them honestly in `MOD_PERMISSIONS`.
