package cc.homeauto.appsbridge

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CopyOnWriteArrayList

class BridgeServer(port: Int) : NanoHTTPD("127.0.0.1", port) {

    private val sseClients = CopyOnWriteArrayList<PipedOutputStream>()

    companion object {
        @Volatile var instance: BridgeServer? = null
    }

    init { instance = this }

    override fun stop() {
        if (instance === this) instance = null
        sseClients.forEach { try { it.close() } catch (_: Exception) {} }
        sseClients.clear()
        super.stop()
    }

    override fun serve(session: IHTTPSession): Response {
        return when {
            session.uri == "/health"      && session.method == Method.GET        -> handleHealth()
            session.uri == "/events"      && session.method == Method.GET        -> handleSse()
            session.uri == "/gps"         && session.method == Method.GET        -> handleGps()
            session.uri == "/media"       && session.method == Method.GET        -> handleMedia()
            session.uri == "/nav"         && session.method == Method.GET        -> handleNav()
            session.uri == "/debug/nav"   && session.method == Method.GET        -> handleNavDebug()
            session.uri == "/media/play"  && session.method == Method.POST       -> handleCommand("play")
            session.uri == "/media/pause" && session.method == Method.POST       -> handleCommand("pause")
            session.uri == "/media/next"  && session.method == Method.POST       -> handleCommand("next")
            session.uri == "/media/prev"  && session.method == Method.POST       -> handleCommand("prev")
            session.method == Method.OPTIONS                                     -> handleOptions()
            else -> cors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found"))
        }
    }

    // ── SSE ───────────────────────────────────────────────────────────────────

    private fun handleSse(): Response {
        val pos = PipedOutputStream()
        val pis = PipedInputStream(pos, 65536)
        sseClients.add(pos)

        // Push current state immediately, then keep the thread alive.
        // Without this, PipedInputStream throws "Write end dead" as soon as the
        // initial write thread exits and NanoHTTPD blocks waiting for the next byte.
        // The 25 s heartbeat comment also prevents proxy/browser idle timeouts.
        Thread {
            try {
                synchronized(pos) {
                    pos.write(sseFrame("gps",   buildGpsJson()).toByteArray())
                    pos.write(sseFrame("media", buildMediaJson()).toByteArray())
                    pos.write(sseFrame("nav",   buildNavJson()).toByteArray())
                    pos.flush()
                }
                while (true) {
                    Thread.sleep(25_000)
                    synchronized(pos) {
                        pos.write(": keepalive\n\n".toByteArray())
                        pos.flush()
                    }
                }
            } catch (_: Exception) { sseClients.remove(pos) }
        }.also { it.isDaemon = true }.start()

        val r = newChunkedResponse(Response.Status.OK, "text/event-stream", pis)
        r.addHeader("Cache-Control", "no-cache")
        r.addHeader("Connection",    "keep-alive")
        r.addHeader("Access-Control-Allow-Origin",  "*")
        r.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
        return r
    }

    fun broadcast(eventType: String, json: String) {
        val bytes = sseFrame(eventType, json).toByteArray(Charsets.UTF_8)
        val dead  = mutableListOf<PipedOutputStream>()
        for (client in sseClients) {
            try { synchronized(client) { client.write(bytes); client.flush() } }
            catch (_: Exception) { dead.add(client) }
        }
        if (dead.isNotEmpty()) sseClients.removeAll(dead.toSet())
    }

    fun broadcastGps()   = broadcast("gps",   buildGpsJson())
    fun broadcastMedia() = broadcast("media", buildMediaJson())
    fun broadcastNav()   = broadcast("nav",   buildNavJson())

    private fun sseFrame(type: String, json: String) = "event: $type\ndata: $json\n\n"

    private fun buildGpsJson() = JSONObject().apply {
        put("speed",    SharedState.gpsSpeed)
        put("heading",  SharedState.gpsHeading  ?: JSONObject.NULL)
        put("lat",      SharedState.gpsLat      ?: JSONObject.NULL)
        put("lng",      SharedState.gpsLng      ?: JSONObject.NULL)
        put("accuracy", SharedState.gpsAccuracy ?: JSONObject.NULL)
    }.toString()

    private fun buildMediaJson() = JSONObject().apply {
        put("title",  SharedState.mediaTitle)
        put("artist", SharedState.mediaArtist)
        put("status", SharedState.mediaStatus)
    }.toString()

    private fun buildNavJson() = JSONObject().apply {
        put("instruction", SharedState.navInstruction)
        put("distance",    SharedState.navDistance)
        put("eta",         SharedState.navEta)
        put("active",      SharedState.navRouteActive)
        if (SharedState.navRouteActive) {
            val iconType = NavResolver.resolve(SharedState.navInstruction)
            if (iconType != null) {
                put("iconType", iconType)
                NavIcons.forType(iconType)?.let {
                    put("icon", android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP))
                }
            }
        }
    }.toString()

    // ── REST ─────────────────────────────────────────────────────────────────────

    private fun handleHealth() = cors(newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, "ok"))

    private fun handleGps()   = cors(newFixedLengthResponse(Response.Status.OK, "application/json", buildGpsJson()))
    private fun handleMedia() = cors(newFixedLengthResponse(Response.Status.OK, "application/json", buildMediaJson()))
    private fun handleNav()   = cors(newFixedLengthResponse(Response.Status.OK, "application/json", buildNavJson()))

    private fun handleNavDebug(): Response {
        val json = JSONObject().apply {
            put("pkg",   SharedState.navDebugPkg)
            put("title", SharedState.navDebugTitle)
            put("text",  SharedState.navDebugText)
            put("big",   SharedState.navDebugBig)
            put("sub",   SharedState.navDebugSub)
            put("parsed_instruction", SharedState.navInstruction)
            put("parsed_distance",    SharedState.navDistance)
            put("parsed_active",      SharedState.navRouteActive)
        }
        return cors(newFixedLengthResponse(Response.Status.OK, "application/json", json.toString()))
    }

    private fun handleCommand(cmd: String): Response {
        MediaListener.instance?.sendCommand(cmd)
        return cors(newFixedLengthResponse(Response.Status.NO_CONTENT, MIME_PLAINTEXT, ""))
    }

    private fun handleOptions() = cors(newFixedLengthResponse(Response.Status.NO_CONTENT, MIME_PLAINTEXT, ""))

    private fun cors(r: Response): Response {
        r.addHeader("Access-Control-Allow-Origin",  "*")
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        r.addHeader("Access-Control-Allow-Headers", "Content-Type")
        return r
    }
}
