package expo.modules.t3agentnotifications

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }

    Function("showShowcaseActivity") { scheme: String, data: Map<String, String> ->
      appContext.reactContext?.let { AgentNotifications.showcase(it, scheme, data) }
    }

    Function("getState") {
      appContext.reactContext?.let { AgentNotifications.state(it) } ?: emptyMap<String, Any>()
    }

    Function("openNotificationSettings") { channel: String? ->
      val context = appContext.reactContext ?: return@Function false
      val intent = if (channel != null && Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_CHANNEL_ID, channel)
      } else if (Build.VERSION.SDK_INT >= 30 && channel == null) {
        Intent(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS)
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      }
      try {
        context.startActivity(
          intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        true
      } catch (_: ActivityNotFoundException) {
        false
      }
    }

    Function("setThreadOnScreen") { path: String? ->
      AgentNotifications.setThreadOnScreen(path)
    }

    Function("openLiveUpdateSettings") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < 36) {
        false
      } else {
        try {
          context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
