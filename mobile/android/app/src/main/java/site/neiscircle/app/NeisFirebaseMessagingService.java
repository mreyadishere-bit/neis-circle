package site.neiscircle.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class NeisFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences("neis_mobile", MODE_PRIVATE)
            .edit().putString("fcm_token", token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        // While NEIS Circle is open, the web app's own realtime/in-app notification UI is enough.
        // Do not create an Android system notification here, so there is no duplicate banner,
        // vibration, or notification sound interrupting the active conversation.
        if (MainActivity.isAppForeground()) {
            return;
        }
        String title = "NEIS Circle";
        String body = "";
        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null) title = message.getNotification().getTitle();
            if (message.getNotification().getBody() != null) body = message.getNotification().getBody();
        }
        if (body.isEmpty()) body = message.getData().getOrDefault("body", "");
        NotificationHelper.show(
            this,
            title,
            body,
            message.getData().getOrDefault("route", ""),
            message.getData().getOrDefault("type", "")
        );
    }
}
