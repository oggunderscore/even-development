package cc.homeauto.appsbridge

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.Collections
import java.util.WeakHashMap
import java.util.Timer
import java.util.TimerTask

/**
 * WebSocket server for real-time push to HUD clients.
 *
 * Hardened for Even Hub lifecycle instability:
 *  - Dead connection pruning on every broadcast (catches zombie sockets)
 *  - Periodic ping keepalive (30s) to detect half-open connections early
 *  - All send/broadcast wrapped in try/catch (never crash the service)
 *  - Connection timeout set tight (10s) to avoid connection accumulation
 */
class WsServer(port: Int) : WebSocketServer(InetSocketAddress("127.0.0.1", port)) {

    companion object {
        @Volatile var instance: WsServer? = null
        private const val PING_INTERVAL_MS = 30_000L
        private const val CONNECTION_LOST_TIMEOUT = 10  // seconds
        private const val LEGACY_IDENTIFY_GRACE_MS = 750L
        private const val MANAGED_CLIENT_TIMEOUT_MS = 45_000L
    }

    /** Called on the WebSocket thread when the first client connects. */
    var onFirstClient: (() -> Unit)? = null
    /** Called on the WebSocket thread when the last client disconnects. */
    var onLastClient: (() -> Unit)? = null
    /** Called whenever the active HUD identity changes without a component change. */
    var onClientStateChanged: (() -> Unit)? = null
    /** Called whenever the union of requested bridge components changes. */
    var onRequestedComponentsChanged: ((Set<BridgeComponent>) -> Unit)? = null

    @Volatile private var clientCount = 0
    private val clientRequests = Collections.synchronizedMap(WeakHashMap<WebSocket, ClientRequest>())
    @Volatile private var lastActiveModule = ""
    @Volatile private var lastStreamingLabel = ""
    @Volatile private var lastRequestedComponents = emptySet<BridgeComponent>()

    private var pingTimer: Timer? = null

    init {
        isReuseAddr = true
        connectionLostTimeout = CONNECTION_LOST_TIMEOUT
        instance = this
    }

    override fun onStart() {
        // Start keepalive ping timer — detects dead clients faster than TCP timeout
        pingTimer = Timer("ws-ping", true).also { timer ->
            timer.scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    pruneAndPing()
                }
            }, PING_INTERVAL_MS, PING_INTERVAL_MS)
        }
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        val count = ++clientCount
        clientRequests[conn] = legacyRequest("unknown", "")
        updateClientState()
        android.util.Log.d("AppsBridge/WS", "client connected — total=$count")
        if (count == 1) onFirstClient?.invoke()
        scheduleLegacyMotoHudFallback(conn)
        // Send full state snapshot on connect so client is immediately current
        try {
            conn.send(frame("gps",   buildGpsJson()))
            conn.send(frame("media", buildMediaJson()))
            conn.send(frame("nav",   buildNavJson()))
            conn.send(buildCcStatusJson().toString())
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge/WS", "onOpen send failed: ${e.message}")
            try { conn.close() } catch (_: Exception) {}
        }
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        val count = maxOf(0, --clientCount)
        clientRequests.remove(conn)
        updateClientState()
        android.util.Log.d("AppsBridge/WS", "client disconnected: code=$code remote=$remote — total=$count")
        if (count == 0) onLastClient?.invoke()
    }

    override fun onMessage(conn: WebSocket, message: String) {
        try {
            val json = JSONObject(message)
            if (json.optString("type") == "client_hello") {
                clientRequests[conn] = parseClientHello(json)
                updateClientState()
                return
            }
            if (json.optString("type") == "client_heartbeat") {
                clientRequests[conn] = parseClientHeartbeat(conn, json)
                updateClientState()
                return
            }
            if (json.optString("type") == "client_goodbye") {
                clientRequests[conn] = inactiveClientRequest(conn, json)
                updateClientState()
                return
            }
            if (json.optString("type") == "cc_state") {
                clientRequests[conn] = legacyRequest("live_cc", "CC Live")
                SharedState.ccEnabled = json.optBoolean("capturing", false)
                SharedState.ccCapturing = json.optBoolean("capturing", false)
                SharedState.ccMode = json.optString("mode", SharedState.ccMode)
                SharedState.ccSource = "g2_webview"
                updateClientState()
                return
            }
            if (json.optString("type") != "cc_command") return
            clientRequests[conn] = legacyRequest("live_cc", "CC Live")
            updateClientState()
            val command = json.optString("command")
            val mode = json.optString("mode")
            if (mode != CaptionMode.PHONE_AUDIO.wireValue) return
            when (command) {
                "start" -> MainActivity.requestPhoneAudioFromClient()
                "stop" -> MainActivity.stopPhoneAudioFromClient(json.optString("reason", "user_stopped"))
            }
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge/WS", "command parse failed: ${e.message}")
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        android.util.Log.w("AppsBridge/WS", "error: ${ex.message}")
        // If error is on a specific connection, close it cleanly
        if (conn != null && conn.isOpen) {
            try { conn.close() } catch (_: Exception) {}
        }
    }

    fun clientCount(): Int = clientCount
    fun activeModuleLabel(): String = SharedState.wsActiveModuleLabel.ifEmpty {
        ""
    }
    fun activeStreamingLabel(): String = when {
        SharedState.wsActiveModule == "motohud" && (SharedState.gpsActive || SharedState.httpActive || SharedState.mediaActive || SharedState.navActive) -> "MotoHUD"
        SharedState.ccCapturing || SharedState.captionsActive -> "CC Live"
        SharedState.requestedComponents.isNotEmpty() -> SharedState.wsActiveModuleLabel.ifEmpty { "HUD" }
        else -> ""
    }

    fun broadcastGps()   = push("gps",   buildGpsJson())
    fun broadcastMedia() = push("media", buildMediaJson())
    fun broadcastNav()   = push("nav",   buildNavJson())
    fun broadcastRaw(json: String) = pushRaw(json)

    fun shutdown() {
        pingTimer?.cancel()
        pingTimer = null
        instance = null
        try { stop(1000) } catch (_: Exception) {}
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private fun push(type: String, json: String) {
        val msg = frame(type, json)
        pushRaw(msg)
    }

    private fun pushRaw(msg: String) {
        val conns = try { connections?.toList() } catch (_: Exception) { null } ?: return
        for (conn in conns) {
            try {
                if (conn.isOpen) conn.send(msg)
            } catch (e: Exception) {
                android.util.Log.w("AppsBridge/WS", "send failed, removing: ${e.message}")
                try { conn.close() } catch (_: Exception) {}
            }
        }
    }

    private fun pruneAndPing() {
        pruneStaleManagedClients()
        val conns = try { connections?.toList() } catch (_: Exception) { null } ?: return
        for (conn in conns) {
            try {
                if (!conn.isOpen) {
                    clientRequests.remove(conn)
                    updateClientState()
                    conn.close()
                } else {
                    conn.sendPing()
                }
            } catch (e: Exception) {
                android.util.Log.d("AppsBridge/WS", "prune/ping failed: ${e.message}")
                try { conn.close() } catch (_: Exception) {}
            }
        }
    }

    private fun pruneStaleManagedClients() {
        val now = System.currentTimeMillis()
        var changed = false
        synchronized(clientRequests) {
            for ((conn, req) in clientRequests.entries.toList()) {
                if (
                    req.managedLifecycle &&
                    req.components.isNotEmpty() &&
                    now - req.updatedAtMs > MANAGED_CLIENT_TIMEOUT_MS
                ) {
                    android.util.Log.w(
                        "AppsBridge/WS",
                        "managed client timed out: ${req.name.ifEmpty { req.app }}",
                    )
                    clientRequests[conn] = req.copy(components = emptySet(), updatedAtMs = now)
                    changed = true
                }
            }
        }
        if (changed) updateClientState()
    }

    private fun scheduleLegacyMotoHudFallback(conn: WebSocket) {
        pingTimer?.schedule(object : TimerTask() {
            override fun run() {
                try {
                    if (!conn.isOpen) return
                    if (clientRequests[conn]?.app == "unknown") {
                        clientRequests[conn] = legacyRequest("motohud", "MotoHUD")
                        updateClientState()
                    }
                } catch (_: Exception) {}
            }
        }, LEGACY_IDENTIFY_GRACE_MS)
    }

    private fun parseClientHello(json: JSONObject): ClientRequest {
        val explicitComponents = parseComponents(json)
        val hasComponents = json.has("components")
        val active = json.optBoolean("active", true)
        val managedLifecycle = json.optBoolean("managedLifecycle", false)
        val module = normalizeModule(
            json.optString("module", json.optString("app")),
            json.optString("name"),
            hasComponents,
        )
        val name = json.optString("name").ifEmpty {
            when (module) {
                "live_cc" -> "CC Live"
                "motohud" -> "MotoHUD"
                else -> module
            }
        }
        return ClientRequest(
            app = module,
            name = name,
            components = when {
                !active -> emptySet()
                hasComponents -> explicitComponents
                else -> legacyComponentsFor(module)
            },
            managedLifecycle = managedLifecycle,
        )
    }

    private fun parseClientHeartbeat(conn: WebSocket, json: JSONObject): ClientRequest {
        val existing = clientRequests[conn] ?: legacyRequest("unknown", "")
        val active = json.optBoolean("active", existing.components.isNotEmpty())
        val hasComponents = json.has("components")
        val explicitComponents = parseComponents(json)
        val components = when {
            !active -> emptySet()
            hasComponents -> explicitComponents
            else -> existing.components
        }
        return existing.copy(
            components = components,
            managedLifecycle = true,
            updatedAtMs = System.currentTimeMillis(),
        )
    }

    private fun inactiveClientRequest(conn: WebSocket, json: JSONObject): ClientRequest {
        val existing = clientRequests[conn] ?: legacyRequest(
            normalizeModule(json.optString("module", json.optString("app")), json.optString("name"), true),
            json.optString("name"),
        )
        return existing.copy(
            components = emptySet(),
            managedLifecycle = true,
            updatedAtMs = System.currentTimeMillis(),
        )
    }

    private fun parseComponents(json: JSONObject): Set<BridgeComponent> {
        val components = json.optJSONArray("components") ?: return emptySet()
        val parsed = mutableSetOf<BridgeComponent>()
        for (i in 0 until components.length()) {
            BridgeComponent.fromWireValue(components.optString(i))?.let { parsed.add(it) }
        }
        return parsed
    }

    private fun legacyRequest(module: String, name: String): ClientRequest =
        ClientRequest(module, name, legacyComponentsFor(module))

    private fun legacyComponentsFor(module: String): Set<BridgeComponent> = when (module) {
        "motohud" -> setOf(BridgeComponent.GPS, BridgeComponent.MEDIA, BridgeComponent.NAV, BridgeComponent.HTTP)
        "live_cc" -> setOf(BridgeComponent.CAPTIONS)
        else -> emptySet()
    }

    private fun normalizeModule(module: String, name: String, hasExplicitComponents: Boolean): String {
        val normalized = module.trim().lowercase().replace("-", "_")
        return when {
            normalized == "live_cc" || normalized == "closed_caption_live" -> "live_cc"
            name.contains("caption", ignoreCase = true) -> "live_cc"
            normalized == "unknown" || normalized.isBlank() -> "unknown"
            hasExplicitComponents -> normalized
            else -> "motohud"
        }
    }

    private fun updateClientState() {
        val requests = synchronized(clientRequests) { clientRequests.values.toList() }
        val modules = requests.map { it.app }
        val requestedComponents = requests.flatMap { it.components }.toSet()
        val active = when {
            modules.contains("live_cc") -> "live_cc"
            modules.contains("motohud") -> "motohud"
            requestedComponents.isNotEmpty() -> requests.firstOrNull { it.components.isNotEmpty() }?.app ?: ""
            else -> ""
        }
        SharedState.wsActiveModule = active
        SharedState.wsActiveModuleLabel = when (active) {
            "live_cc" -> "CC Live"
            "motohud" -> "MotoHUD"
            "" -> ""
            else -> requests.firstOrNull { it.app == active }?.name?.ifEmpty { active } ?: active
        }
        SharedState.requestedComponents = BridgeComponent.wireValues(requestedComponents)
        val streamingLabel = when {
            active == "motohud" -> "MotoHUD"
            SharedState.ccCapturing || SharedState.captionsActive -> "CC Live"
            else -> ""
        }
        if (requestedComponents != lastRequestedComponents) {
            lastRequestedComponents = requestedComponents
            onRequestedComponentsChanged?.invoke(requestedComponents)
        }
        val clientStateChanged = active != lastActiveModule || streamingLabel != lastStreamingLabel
        if (clientStateChanged) {
            lastActiveModule = active
            lastStreamingLabel = streamingLabel
            onClientStateChanged?.invoke()
        }
    }

    private fun frame(type: String, json: String) = """{"type":"$type","data":$json}"""

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

    private fun buildCcStatusJson() = JSONObject().apply {
        put("type", "cc_status")
        put("enabled", SharedState.ccEnabled)
        put("capturing", SharedState.ccCapturing)
        put("mode", SharedState.ccMode)
        put("engine", SharedState.ccEngine)
        put("source", SharedState.ccSource)
        if (SharedState.ccLastError.isNotEmpty()) put("lastError", SharedState.ccLastError)
        put("timestamp", System.currentTimeMillis())
    }
}
