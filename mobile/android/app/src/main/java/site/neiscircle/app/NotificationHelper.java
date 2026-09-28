package site.neiscircle.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class NotificationHelper {
    public static final String CHANNEL_MESSAGES = "neis_messages";
    public static final String CHANNEL_GENERAL = "neis_general";

    private NotificationHelper() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build();

        NotificationChannel messages = new NotificationChannel(
            CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("Direct messages and Circle chat");
        messages.enableVibration(true);
        messages.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audio);

        NotificationChannel general = new NotificationChannel(
            CHANNEL_GENERAL, "NEIS Circle notifications", NotificationManager.IMPORTANCE_HIGH);
        general.setDescription("Replies, followers, invitations and announcements");
        general.enableVibration(true);
        general.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audio);

        manager.createNotificationChannel(messages);
        manager.createNotificationChannel(general);
    }

    public static void show(Context context, String title, String body, String route, String type) {
        createChannels(context);
        String channel = ("message".equals(type) || "circle_message".equals(type))
            ? CHANNEL_MESSAGES : CHANNEL_GENERAL;

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("route", route == null ? "" : route);

        int requestCode = (route == null ? 0 : route.hashCode()) ^ (int)System.currentTimeMillis();
        PendingIntent pending = PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "NEIS Circle" : title)
            .setContentText(body == null ? "" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE);

        try {
            NotificationManagerCompat.from(context).notify(
                (int)(System.currentTimeMillis() & 0x7fffffff), builder.build());
        } catch (SecurityException ignored) { }
    }
}
