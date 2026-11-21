package com.codexagents.dashboard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class WaitingNotifications {
  private static final String CHANNEL = "waiting-sessions";
  private static final int ID = 1;
  // The bundled page title reflects the same waiting count as the Android header.
  private static final Pattern WAITING_TITLE = Pattern.compile("^\\((\\d{1,3}) waiting\\) Codex / Agents$");
  private final Context context;
  private final NotificationManager manager;
  private final PendingIntent openDashboard;
  private int waitingCount = -1;
  private int publishedCount;

  WaitingNotifications(Context context) {
    this.context = context.getApplicationContext();
    manager = context.getSystemService(NotificationManager.class);
    manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Waiting sessions", NotificationManager.IMPORTANCE_HIGH));
    Intent dashboard = new Intent(context, DashboardActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    openDashboard = PendingIntent.getActivity(context, 0, dashboard, PendingIntent.FLAG_IMMUTABLE);
  }

  void updateFromTitle(String title) {
    if (title == null) return;
    if ("Codex / Agents".equals(title)) {
      setWaitingCount(0);
      return;
    }
    Matcher match = WAITING_TITLE.matcher(title);
    if (match.matches()) setWaitingCount(Integer.parseInt(match.group(1)));
  }

  void setWaitingCount(int count) {
    if (waitingCount == count) return;
    waitingCount = count;
    refresh();
  }

  void refresh() {
    if (waitingCount == 0) {
      manager.cancel(ID);
      publishedCount = 0;
      return;
    }
    if (!manager.areNotificationsEnabled()) return;
    String message = waitingCount == 1 ? "1 idle session" : waitingCount + " idle sessions";
    Notification notification = new Notification.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_notify_error)
        .setContentTitle(message)
        .setContentIntent(openDashboard)
        .setCategory(Notification.CATEGORY_STATUS)
        .setOnlyAlertOnce(waitingCount <= publishedCount)
        .setAutoCancel(true)
        .build();
    manager.notify(ID, notification);
    publishedCount = waitingCount;
  }
}
