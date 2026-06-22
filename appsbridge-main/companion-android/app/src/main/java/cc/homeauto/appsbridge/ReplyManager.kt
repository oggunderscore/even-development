package cc.homeauto.appsbridge

import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.StatusBarNotification
import java.util.concurrent.ConcurrentHashMap

object ReplyManager {

    private val registry = ConcurrentHashMap<String, StatusBarNotification>()

    fun register(id: String, sbn: StatusBarNotification) {
        registry[id] = sbn
    }

    fun sendReply(id: String, body: String, context: Context): Boolean {
        val sbn = registry[id] ?: run {
            android.util.Log.w("AppsBridge/Reply", "no notification registered for id=$id")
            return false
        }
        return try {
            fireReply(sbn, body, context)
            registry.remove(id)
            true
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge/Reply", "reply failed: ${e.message}")
            false
        }
    }

    private fun fireReply(sbn: StatusBarNotification, body: String, context: Context) {
        val actions = sbn.notification?.actions ?: return
        // Prefer an action explicitly marked as reply, fall back to any action with RemoteInput
        val action = actions.firstOrNull { it.semanticAction == android.app.Notification.Action.SEMANTIC_ACTION_REPLY }
            ?: actions.firstOrNull { it.remoteInputs?.isNotEmpty() == true }
            ?: return

        val remoteInput = action.remoteInputs?.firstOrNull() ?: return
        val intent = Intent()
        val bundle = Bundle()
        bundle.putCharSequence(remoteInput.resultKey, body)
        RemoteInput.addResultsToIntent(arrayOf(remoteInput), intent, bundle)
        action.actionIntent.send(context, 0, intent)
        android.util.Log.d("AppsBridge/Reply", "reply sent via RemoteInput")
    }
}
