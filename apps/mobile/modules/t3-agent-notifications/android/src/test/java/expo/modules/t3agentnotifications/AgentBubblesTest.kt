package expo.modules.t3agentnotifications

import org.junit.Assert.assertEquals
import org.junit.Test

class AgentBubblesTest {
  private val running = mapOf(
    "active" to "true",
    "activity_line_0" to "Working\tFix the build\tKavyaan",
    "activity_thread_0" to "running\t/threads/env/one",
    "activity_line_1" to "Approval\tShip it\tKavyaan",
    "activity_thread_1" to "waiting_for_approval\t/threads/env/two",
    "activity_line_2" to "Done\tOld work\tKavyaan",
    "activity_thread_2" to "completed\t/threads/env/three"
  )

  @Test
  fun bubblesEveryRunningThreadOnAndroid11AndLater() {
    val threads = AgentBubbles.eligibleThreads(30, false, true, running)
    assertEquals(listOf("/threads/env/one", "/threads/env/two"), threads.map { it.path })
    assertEquals("Fix the build", threads[0].title)
    assertEquals("Approval", threads[1].status)
  }

  @Test
  fun respectsSdkUserSettingsAndOngoingPreference() {
    assertEquals(emptyList<BubbleThread>(), AgentBubbles.eligibleThreads(29, false, true, running))
    assertEquals(emptyList<BubbleThread>(), AgentBubbles.eligibleThreads(34, true, true, running))
    assertEquals(emptyList<BubbleThread>(), AgentBubbles.eligibleThreads(34, false, false, running))
    assertEquals(
      emptyList<BubbleThread>(),
      AgentBubbles.eligibleThreads(34, false, true, running + ("active" to "false"))
    )
  }

  @Test
  fun skipsRowsWithoutAThreadPath() {
    val data = running + ("activity_thread_0" to "running\t/settings?x=1")
    assertEquals(
      listOf("/threads/env/two"),
      AgentBubbles.eligibleThreads(34, false, true, data).map { it.path }
    )
  }
}
