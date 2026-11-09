package expo.modules.t3agentnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

internal data class BubbleThread(
  val path: String,
  val status: String,
  val title: String,
  val project: String
)

/**
 * One conversation bubble per running agent thread (Android 11+). Each thread gets a
 * long-lived shortcut and a MessagingStyle notification whose bubble opens that thread in
 * [AgentBubbleActivity]; threads that stop running lose their bubble.
 */
internal object AgentBubbles {
  const val CHANNEL = "agent-bubbles"
  const val EXTRA_PATH = "bubblePath"
  private const val TAG = "t3-agent-bubble"
  private const val SHORTCUT_PREFIX = "agent-thread:"
  private val RUNNING_PHASES = setOf("starting", "running", "waiting_for_approval", "waiting_for_input")

  /** Threads that should have a bubble now; empty when bubbles cannot or must not show. */
  fun eligibleThreads(
    sdk: Int,
    bubblesBlocked: Boolean,
    ongoingEnabled: Boolean,
    data: Map<String, String>
  ): List<BubbleThread> {
    if (sdk < 30 || bubblesBlocked || !ongoingEnabled || data["active"] != "true") return emptyList()
    return (0 until 5).mapNotNull { index ->
      val thread = data["activity_thread_$index"]?.split('\t') ?: return@mapNotNull null
      val phase = thread.getOrNull(0)
      val path = thread.getOrNull(1)
      if (phase !in RUNNING_PHASES || path == null || !isThreadPath(path)) return@mapNotNull null
      val line = data["activity_line_$index"]?.split('\t').orEmpty()
      BubbleThread(
        path = path,
        status = line.getOrNull(0).orEmpty(),
        title = line.getOrNull(1)?.takeIf { it.isNotBlank() } ?: "Agent thread",
        project = line.getOrNull(2).orEmpty()
      )
    }
  }

  fun isThreadPath(path: String) =
    path.startsWith("/threads/") && !path.contains('?') && !path.contains('#')

  /** NONE turns bubbles off for this app; SELECTED still lets the user bubble one thread. */
  fun bubblesBlocked(manager: NotificationManager): Boolean = when {
    Build.VERSION.SDK_INT >= 31 ->
      manager.bubblePreference == NotificationManager.BUBBLE_PREFERENCE_NONE
    Build.VERSION.SDK_INT >= 30 -> !manager.areBubblesAllowed()
    else -> true
  }

  fun update(context: Context, scheme: String, ongoingEnabled: Boolean, data: Map<String, String>) {
    if (Build.VERSION.SDK_INT < 30) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val threads = eligibleThreads(Build.VERSION.SDK_INT, bubblesBlocked(manager), ongoingEnabled, data)
    post(context, manager, scheme, threads)
  }

  fun clear(context: Context) {
    if (Build.VERSION.SDK_INT < 30) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.activeNotifications.filter { it.tag == TAG }.forEach { manager.cancel(TAG, it.id) }
  }

  @RequiresApi(30)
  private fun post(
    context: Context,
    manager: NotificationManager,
    scheme: String,
    threads: List<BubbleThread>
  ) {
    val keep = threads.map { it.path.hashCode() }.toSet()
    manager.activeNotifications
      .filter { it.tag == TAG && it.id !in keep }
      .forEach { manager.cancel(TAG, it.id) }
    if (threads.isEmpty()) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "Agent thread bubbles", NotificationManager.IMPORTANCE_HIGH).apply {
        setAllowBubbles(true)
      }
    )
    val icon = IconCompat.createWithResource(context, R.drawable.agent_activity_mark)
    val you = Person.Builder().setName("You").build()
    for (thread in threads) {
      val shortcutId = SHORTCUT_PREFIX + thread.path
      val uri = Uri.parse("$scheme:/${thread.path}")
      val agent = Person.Builder()
        .setName(thread.title)
        .setKey(shortcutId)
        .setBot(true)
        .setImportant(true)
        .setIcon(icon)
        .build()
      val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.setAction(Intent.ACTION_VIEW)
        ?.setData(uri)
        ?: continue
      ShortcutManagerCompat.pushDynamicShortcut(
        context,
        ShortcutInfoCompat.Builder(context, shortcutId)
          .setLongLived(true)
          .setShortLabel(thread.title.take(24))
          .setLongLabel(thread.title)
          .setIcon(icon)
          .setPerson(agent)
          .setIntent(openIntent)
          .build()
      )
      val id = thread.path.hashCode()
      // Bubbles need a mutable intent; the activity reads only its own data URI.
      val bubbleIntent = PendingIntent.getActivity(
        context,
        id,
        Intent(context, AgentBubbleActivity::class.java)
          .setAction(Intent.ACTION_VIEW)
          .setData(uri)
          .putExtra(EXTRA_PATH, thread.path),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
      )
      val contentIntent = PendingIntent.getActivity(
        context,
        id,
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val text = listOf(thread.status, thread.project).filter { it.isNotBlank() }.joinToString(": ")
      val notification = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.agent_activity_mark)
        .setContentTitle(thread.title)
        .setContentText(text)
        .setStyle(
          NotificationCompat.MessagingStyle(you)
            .addMessage(text.ifBlank { "Working" }, System.currentTimeMillis(), agent)
        )
        .setShortcutId(shortcutId)
        .setLocusId(LocusIdCompat(shortcutId))
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setBubbleMetadata(
          NotificationCompat.BubbleMetadata.Builder(bubbleIntent, icon)
            .setDesiredHeight(640)
            .setSuppressNotification(true)
            .build()
        )
        .setContentIntent(contentIntent)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .build()
      manager.notify(TAG, id, notification)
    }
  }
}
