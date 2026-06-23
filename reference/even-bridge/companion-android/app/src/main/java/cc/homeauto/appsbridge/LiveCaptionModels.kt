package cc.homeauto.appsbridge

import android.util.Base64
import org.json.JSONObject

enum class CaptionMode(val wireValue: String, val source: String, val label: String) {
    PHONE_AUDIO("phone_audio", "android_media", "Phone Audio")
}

object LiveCaptionSender {
    fun status(enabled: Boolean, capturing: Boolean, mode: CaptionMode, reason: String? = null) {
        SharedState.ccEnabled = enabled
        SharedState.ccCapturing = capturing
        SharedState.ccMode = mode.wireValue
        SharedState.ccSource = mode.source
        SharedState.ccEngine = "webview_whisper"
        val json = base("cc_status", mode).apply {
            put("enabled", enabled)
            put("capturing", capturing)
            put("engine", SharedState.ccEngine)
            if (reason != null) put("reason", reason)
        }
        WsServer.instance?.broadcastRaw(json.toString())
    }

    fun partial(text: String, mode: CaptionMode) {
        WsServer.instance?.broadcastRaw(base("caption_partial", mode).apply {
            put("text", text.take(MAX_CAPTION_CHARS))
        }.toString())
    }

    fun final(text: String, mode: CaptionMode) {
        WsServer.instance?.broadcastRaw(base("caption_final", mode).apply {
            put("text", text.take(MAX_CAPTION_CHARS))
        }.toString())
    }

    fun audioPcm16(samples: ShortArray, sampleRate: Int, mode: CaptionMode) {
        val bytes = ByteArray(samples.size * 2)
        var offset = 0
        for (sample in samples) {
            val value = sample.toInt()
            bytes[offset++] = (value and 0xff).toByte()
            bytes[offset++] = ((value shr 8) and 0xff).toByte()
        }
        WsServer.instance?.broadcastRaw(base("cc_audio", mode).apply {
            put("format", "pcm_s16le")
            put("sampleRate", sampleRate)
            put("channels", 1)
            put("audioBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }.toString())
    }

    fun error(message: String, mode: CaptionMode) {
        SharedState.ccLastError = message
        WsServer.instance?.broadcastRaw(base("cc_error", mode).apply {
            put("message", message)
        }.toString())
    }

    private fun base(type: String, mode: CaptionMode) = JSONObject().apply {
        put("type", type)
        put("mode", mode.wireValue)
        put("source", mode.source)
        put("timestamp", System.currentTimeMillis())
    }

    private const val MAX_CAPTION_CHARS = 500
}
