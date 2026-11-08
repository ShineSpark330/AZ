// Opens another app on this phone, or says whether it's installed.
//
// Used by the mod broker (src/lib/mods/broker.js) for the "apps:launch"
// permission. Android only: the AppLauncher plugin (AppLauncherPlugin.java)
// asks the system for the app's launch screen and starts it. On the web build
// and on iOS there's no way to do this, so the answers are "unsupported" /
// null and a mod falls back to showing its link instead.
//
// It can only start an app's normal launch screen (what tapping its icon
// does). It can't open any other screen inside an app, pass it anything, or
// list what's installed: a package name goes in, installed yes/no comes out.

import { registerPlugin } from "@capacitor/core";
import { getNativePlatform } from "@/lib/platform";

const isAndroid = () => getNativePlatform() === "android";

const AppLauncher = registerPlugin("AppLauncher");

// → true | false | null (null: this device can't tell)
export async function isAppInstalled(packageName) {
  if (!isAndroid()) return null;
  try {
    const res = await AppLauncher.isInstalled({ package: packageName });
    return !!res?.installed;
  } catch {
    return null;
  }
}

// → "opened" | "not-installed" | "unsupported" | "failed"
export async function openInstalledApp(packageName) {
  if (!isAndroid()) return "unsupported";
  try {
    const res = await AppLauncher.open({ package: packageName });
    if (res?.launched) return "opened";
    return res?.installed === false ? "not-installed" : "failed";
  } catch {
    return "failed";
  }
}
