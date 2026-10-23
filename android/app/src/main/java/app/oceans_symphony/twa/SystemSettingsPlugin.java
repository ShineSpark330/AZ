package app.oceans_symphony.twa;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What stands between a reminder and the person, and one-tap ways to fix
 * it (owner, 2026-10-01: "there is no quick way to redirect the user to
 * enable them"). Read by src/lib/notificationHealth.js.
 *
 *   status()                   notifications allowed? on-time (exact) alarms
 *                              allowed? battery unrestricted? reminders
 *                              channel muted?
 *   openNotificationSettings() this app's notification settings page
 *   openExactAlarmSettings()   "Alarms & reminders" for this app (Android 12+)
 *   openBatterySettings()      this app's info page — Battery → Unrestricted
 *                              lives there. (Deliberately NOT the direct
 *                              "ignore battery optimisations" prompt, which
 *                              needs a permission Google Play restricts.)
 *
 * Every opener falls back to the app's info page if the specific screen
 * doesn't exist on this phone.
 */
@CapacitorPlugin(name = "SystemSettings")
public class SystemSettingsPlugin extends Plugin {

    // Must match REMINDERS_CHANNEL_ID in src/lib/nativeNotifications.js.
    private static final String REMINDERS_CHANNEL = "reminders-default-v2";

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        JSObject r = new JSObject();
        r.put("notificationsEnabled", NotificationManagerCompat.from(ctx).areNotificationsEnabled());

        boolean exact = true;
        if (Build.VERSION.SDK_INT >= 31) {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            exact = am == null || am.canScheduleExactAlarms();
        }
        r.put("exactAlarms", exact);

        boolean unrestricted = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            unrestricted = pm == null || pm.isIgnoringBatteryOptimizations(pkg);
        }
        r.put("batteryUnrestricted", unrestricted);

        boolean muted = false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(REMINDERS_CHANNEL);
            muted = ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE;
        }
        r.put("remindersChannelMuted", muted);
        call.resolve(r);
    }

    /**
     * Is another app (a music player, a podcast) playing right now? Read
     * by src/lib/otherAudio.js so a profile song never starts on its own
     * over someone's music: starting web audio takes the phone's audio
     * focus, and music apps stop when they lose it.
     */
    @PluginMethod
    public void otherAudioPlaying(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject r = new JSObject();
        r.put("playing", soundActive(am));
        call.resolve(r);
    }

    /**
     * Music or video playing in another app, OR an alarm, a ringtone or a call.
     * isMusicActive() alone only sees the music stream, so an alarm going off
     * paused the song (the phone takes the audio focus) and nothing ever noticed
     * to carry it on afterwards.
     */
    private boolean soundActive(AudioManager am) {
        if (am == null) return false;
        try {
            if (am.isMusicActive()) return true;
            int mode = am.getMode();
            if (mode == AudioManager.MODE_IN_CALL
                || mode == AudioManager.MODE_RINGTONE
                || mode == AudioManager.MODE_IN_COMMUNICATION) return true;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                java.util.List<android.media.AudioPlaybackConfiguration> configs = am.getActivePlaybackConfigurations();
                if (configs != null) {
                    for (android.media.AudioPlaybackConfiguration c : configs) {
                        android.media.AudioAttributes attrs = c.getAudioAttributes();
                        if (attrs == null) continue;
                        int usage = attrs.getUsage();
                        if (usage == android.media.AudioAttributes.USAGE_ALARM
                            || usage == android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE
                            || usage == android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION
                            || usage == android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING) return true;
                    }
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    // ── Waiting for other apps' audio to stop ───────────────────────────
    // The "Automatic. Play when no music is playing." song uses this to
    // start (or carry on) once another app — Facebook, the Gallery, a music
    // player — has gone quiet, including while this app is in the
    // background. It only LOOKS: it never asks for audio focus itself (a
    // second request from this app would knock the web view's own off).
    // Fires "otherAudioQuiet" after the phone reports no sound for ~1 s,
    // so the gap between two tracks doesn't count as quiet (it used to wait
    // about 2 s, which made a song feel slow to come back).
    private Handler quietHandler;
    private Runnable quietPoll;
    private int quietCount = 0;

    private void stopQuietWatch() {
        if (quietHandler != null && quietPoll != null) quietHandler.removeCallbacks(quietPoll);
        quietPoll = null;
    }

    @PluginMethod
    public void watchOtherAudio(PluginCall call) {
        stopQuietWatch();
        quietCount = 0;
        if (quietHandler == null) quietHandler = new Handler(Looper.getMainLooper());
        quietPoll = new Runnable() {
            @Override
            public void run() {
                AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
                if (soundActive(am)) quietCount = 0; else quietCount++;
                if (quietCount >= 4) {
                    quietPoll = null;
                    notifyListeners("otherAudioQuiet", new JSObject());
                } else {
                    quietHandler.postDelayed(this, 250);
                }
            }
        };
        quietHandler.postDelayed(quietPoll, 250);
        call.resolve();
    }

    @PluginMethod
    public void stopWatchingOtherAudio(PluginCall call) {
        stopQuietWatch();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopQuietWatch();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            i = appDetails(pkg);
        }
        open(i, call);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= 31) {
            open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg)), call);
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        open(appDetails(getContext().getPackageName()), call);
    }

    private static Intent appDetails(String pkg) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
    }

    private void open(Intent i, PluginCall call) {
        String pkg = getContext().getPackageName();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                Intent fallback = appDetails(pkg);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Couldn't open the phone's settings");
            }
        }
    }
}
