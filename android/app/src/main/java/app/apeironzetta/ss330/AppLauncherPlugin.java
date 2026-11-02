package app.apeironzetta.ss330;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.regex.Pattern;

/**
 * Lets a mod with the "apps:launch" permission open another app, or check
 * whether it is installed. The JS side (src/lib/nativeAppLauncher.js, called
 * through src/lib/mods/broker.js) has already checked the permission and the
 * package name; this checks the name again and does only two things:
 *
 *   isInstalled({ package }) -> { installed }
 *   open({ package })        -> { installed, launched }
 *
 * "open" starts the app's normal launch screen (the one its home-screen icon
 * opens) and nothing else: no other screens, no extras, no data passed in.
 * The AndroidManifest {@code <queries>} block is what lets Android 11+ show
 * this app which launchable apps exist; the plugin only ever answers about the
 * single package it is asked about and can't list anything.
 */
@CapacitorPlugin(name = "AppLauncher")
public class AppLauncherPlugin extends Plugin {

    private static final Pattern PACKAGE_RE =
            Pattern.compile("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$");

    private String packageArg(PluginCall call) {
        String pkg = call.getString("package");
        if (pkg == null || pkg.length() > 200 || !PACKAGE_RE.matcher(pkg).matches()) {
            call.reject("Not a valid app name");
            return null;
        }
        return pkg;
    }

    private Intent launchIntent(String pkg) {
        try {
            PackageManager pm = getContext().getPackageManager();
            return pm.getLaunchIntentForPackage(pkg);
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String pkg = packageArg(call);
        if (pkg == null) return;
        JSObject ret = new JSObject();
        ret.put("installed", launchIntent(pkg) != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String pkg = packageArg(call);
        if (pkg == null) return;
        JSObject ret = new JSObject();
        Intent intent = launchIntent(pkg);
        if (intent == null) {
            ret.put("installed", false);
            ret.put("launched", false);
            call.resolve(ret);
            return;
        }
        ret.put("installed", true);
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Context ctx = getActivity() != null ? getActivity() : getContext();
            ctx.startActivity(intent);
            ret.put("launched", true);
        } catch (Exception e) {
            ret.put("launched", false);
        }
        call.resolve(ret);
    }
}
