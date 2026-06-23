package cc.homeauto.appsbridge

import android.content.Context
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI
import java.nio.ByteBuffer

class DeepgramProxy(private val context: Context) {

    companion object {
        @Volatile var instance: DeepgramProxy? = null
        const val PREFS_NAME = "appsbridge_prefs"
        const val KEY_API_KEY = "deepgram_api_key"
    }

    private var client: WebSocketClient? = null
    @Volatile private var currentId: String = ""
    @Volatile private var onTranscript: ((String, Boolean) -> Unit)? = null

    fun apiKey(): String =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_API_KEY, "") ?: ""

    fun setApiKey(key: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_API_KEY, key).apply()
    }

    fun start(notificationId: String, onTranscript: (text: String, isFinal: Boolean) -> Unit) {
        stop()
        val key = apiKey()
        if (key.isEmpty()) {
            android.util.Log.w("AppsBridge/Deepgram", "No API key configured")
            return
        }
        currentId = notificationId
        this.onTranscript = onTranscript

        val uri = URI(
            "wss://api.deepgram.com/v1/listen" +
            "?model=nova-2&language=en&encoding=linear16" +
            "&sample_rate=16000&channels=1&interim_results=true"
        )
        val headers = mapOf("Authorization" to "Token $key")

        client = object : WebSocketClient(uri, headers) {
            override fun onOpen(handshake: ServerHandshake?) {
                android.util.Log.d("AppsBridge/Deepgram", "connected")
            }
            override fun onMessage(message: String?) {
                message ?: return
                try {
                    val json = JSONObject(message)
                    val isFinal = json.optBoolean("is_final", false)
                    val transcript = json
                        .optJSONObject("channel")
                        ?.optJSONArray("alternatives")
                        ?.optJSONObject(0)
                        ?.optString("transcript", "")
                        ?: ""
                    if (transcript.isNotEmpty()) {
                        onTranscript?.invoke(transcript, isFinal)
                    }
                } catch (e: Exception) {
                    android.util.Log.w("AppsBridge/Deepgram", "parse error: ${e.message}")
                }
            }
            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                android.util.Log.d("AppsBridge/Deepgram", "closed code=$code reason=$reason")
            }
            override fun onError(ex: Exception?) {
                android.util.Log.w("AppsBridge/Deepgram", "error: ${ex?.message}")
            }
        }
        try {
            client?.connect()
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge/Deepgram", "connect failed: ${e.message}")
        }
    }

    fun sendChunk(pcm: ByteArray) {
        try {
            if (client?.isOpen == true) {
                client?.send(ByteBuffer.wrap(pcm))
            }
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge/Deepgram", "sendChunk failed: ${e.message}")
        }
    }

    fun stop() {
        onTranscript = null
        try { client?.close() } catch (_: Exception) {}
        client = null
    }
}
