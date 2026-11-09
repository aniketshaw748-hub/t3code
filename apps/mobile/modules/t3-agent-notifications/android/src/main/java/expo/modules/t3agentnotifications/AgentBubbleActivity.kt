package expo.modules.t3agentnotifications

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * The expanded view of an agent thread bubble. It mounts the app's root component again with
 * `bubblePath`, which renders that one thread in a compact screen instead of the full app.
 */
class AgentBubbleActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(
      this,
      mainComponentName,
      DefaultNewArchitectureEntryPoint.fabricEnabled
    ) {
      override fun getLaunchOptions(): Bundle = Bundle().apply {
        val path = intent?.getStringExtra(AgentBubbles.EXTRA_PATH)
        if (path != null && AgentBubbles.isThreadPath(path)) putString("bubblePath", path)
      }
    }
}
