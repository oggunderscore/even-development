package com.evenrealities.flipperbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.flipperdevices.protobuf.Flipper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest

/**
 * Foreground service that hosts the WebSocket server and either the real
 * BLE Flipper client or the StubFrameSource (compile-time flag).
 */
class BridgeService : LifecycleService() {

    private lateinit var wsServer: WsServer
    private val rpc = FlipperRpc()
    private var ble: FlipperBleClient? = null
    @Volatile private var currentBleState: FlipperBleClient.State = FlipperBleClient.State.IDLE
    private var stub: StubFrameSource? = null

    // Status counters surfaced to MainActivity via the local broadcast.
    @Volatile private var frameCount: Int = 0
    @Volatile private var skipCount: Int = 0
    @Volatile private var seq: Int = 0

    // Closed-loop pacing state, all guarded by dedupMutex.
    private val dedupMutex = Mutex()
    private var lastFrameHash: ByteArray = ByteArray(0)
    // The freshest frame we have transcoded but not necessarily sent yet, plus
    // its seq. The client gets whatever is latest when it next grants a credit,
    // so intermediate frames during a busy render are coalesced away.
    private var latestFrame: ByteArray? = null
    private var latestSeq: Int = 0
    private var lastSentSeq: Int = -1
    private var lastSentMs: Long = 0
    // Credit: the client has rendered the previous frame and wants the next.
    // Granted on connect and on each `ready` message.
    private var clientReady: Boolean = false
    // Burst-policy state: arrival time of the previous DISTINCT frame (gap
    // detection) and the settle-flush timer.
    private var prevDistinctMs: Long = 0
    private var settleJob: kotlinx.coroutines.Job? = null

    override fun onCreate() {
        super.onCreate()
        wsServer = WsServer(
            onClientMessage = ::handleClientMessage,
            onFirstClientConnected = ::onFirstWsClient,
            onLastClientDisconnected = ::onLastWsClient,
            currentStatus = ::currentWsStatus
        )
        if (BuildConfig.USE_STUB) {
            stub = StubFrameSource { s, bytes -> wsServer.broadcastFrame(s, bytes) }
        } else {
            ble = FlipperBleClient(this).apply {
                listener = bleListener
                onReceive = ::onBleBytes
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopBridge()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_SCAN_CONNECT -> {
                startScanAndConnect()
            }
            ACTION_DISCONNECT -> {
                ble?.disconnect()
            }
            ACTION_BUTTON -> {
                val key = intent.getStringExtra(EXTRA_BUTTON_KEY) ?: return START_STICKY
                val action = intent.getStringExtra(EXTRA_BUTTON_ACTION) ?: "short"
                routeButton(key, action)
            }
            else -> startBridge()
        }
        return START_STICKY
    }

    private fun startBridge() {
        startForegroundCompat()
        wsServer.start()
        stub?.start(lifecycleScope)
        lifecycleScope.launch {
            wsServer.broadcastStatus(
                "disconnected",
                if (BuildConfig.USE_STUB) "stub mode" else "idle"
            )
        }
        broadcastUiStatus("running")
        Log.i(TAG, "bridge started (stub=${BuildConfig.USE_STUB})")
        // BLE connect is deferred until the first WebSocket client connects
        // (i.e. the Even Realities app opens on the glasses). This keeps the
        // bridge lightweight when idle after boot.
    }

    /**
     * Called when the first WebSocket client connects — the Even Realities
     * glasses app has opened. Start BLE scan/connect to the Flipper now.
     */
    /**
     * Real connection status for greeting a freshly-connected WS client, so the
     * glasses see the ACTUAL state instead of a hardcoded "disconnected / stub
     * mode" on every (re)connect.
     */
    private fun currentWsStatus(): Pair<String, String?> {
        if (BuildConfig.USE_STUB) return "connected" to "stub mode"
        return when (currentBleState) {
            FlipperBleClient.State.READY -> "connected" to null
            FlipperBleClient.State.SCANNING,
            FlipperBleClient.State.CONNECTING,
            FlipperBleClient.State.DISCOVERING -> "scanning" to null
            else -> "disconnected" to "idle"
        }
    }

    private fun onFirstWsClient() {
        Log.i(TAG, "first WS client connected — initiating BLE connect")
        if (!BuildConfig.USE_STUB) {
            startScanAndConnect()
        }
    }

    /**
     * Called when the last WebSocket client disconnects — the Even Realities
     * glasses app has closed. Disconnect BLE to save battery.
     */
    private fun onLastWsClient() {
        Log.i(TAG, "last WS client disconnected — disconnecting BLE")
        ble?.disconnect()
        broadcastUiStatus("idle", "waiting for glasses app")
    }

    private fun stopBridge() {
        stub?.stop()
        ble?.disconnect()
        wsServer.stop()
        broadcastUiStatus("stopped")
        Log.i(TAG, "bridge stopped")
    }

    private fun startScanAndConnect() {
        val b = ble ?: return
        // Fresh session: drop any half-parsed frame left in the RPC buffer from
        // a previous connection, or the new stream never decodes.
        rpc.reset()
        // Auto-connect on first matching scan result.
        b.listener = object : FlipperBleClient.Listener {
            override fun onScanResult(device: BluetoothDevice, rssi: Int) {
                Log.i(TAG, "scan hit: ${safeName(device)} rssi=$rssi")
                b.listener = bleListener
                broadcastDeviceInfo(device, rssi)
                b.connect(device)
            }
            override fun onStateChange(state: FlipperBleClient.State, info: String?) {
                bleListener.onStateChange(state, info)
            }
        }
        if (!b.startScan()) {
            Log.w(TAG, "startScan refused")
        }
    }

    private val bleListener = object : FlipperBleClient.Listener {
        override fun onScanResult(device: BluetoothDevice, rssi: Int) {
            broadcastDeviceInfo(device, rssi)
        }

        override fun onStateChange(state: FlipperBleClient.State, info: String?) {
            Log.i(TAG, "BLE state=$state info=$info")
            currentBleState = state
            val wsState = when (state) {
                FlipperBleClient.State.SCANNING -> "scanning"
                FlipperBleClient.State.CONNECTING,
                FlipperBleClient.State.DISCOVERING -> "scanning"
                FlipperBleClient.State.READY -> "connected"
                FlipperBleClient.State.DISCONNECTED,
                FlipperBleClient.State.IDLE -> "disconnected"
            }
            lifecycleScope.launch { wsServer.broadcastStatus(wsState, info) }
            broadcastUiStatus(state.name.lowercase(), info)
            // Surface the device on the bonded fast-path too. startScanAndConnect
            // only broadcasts device info from a scan hit, but when a Flipper is
            // already bonded we skip scanning and connect directly - so without
            // this the UI would stay on "No Flipper" the entire session even
            // while fully connected. connectedDevice is set as soon as we begin
            // connecting.
            if (state == FlipperBleClient.State.CONNECTING ||
                state == FlipperBleClient.State.READY
            ) {
                ble?.connectedDevice?.let { broadcastDeviceInfo(it, ble?.lastRssi ?: 0) }
            }
            if (state == FlipperBleClient.State.READY) {
                // Fresh BLE link: clear the dedup hash and prime a credit before
                // the stream starts. This service outlives the glasses app, so
                // lastFrameHash from the PREVIOUS session persists across a
                // reconnect - and a static Flipper screen streams byte-identical
                // frames, so the first frame of the new session would be skipped
                // as a duplicate and the glasses would sit forever on "waiting
                // for Flipper screen…". Resetting guarantees the first frame of
                // every new session renders.
                lifecycleScope.launch {
                    dedupMutex.withLock {
                        lastFrameHash = ByteArray(0)
                        clientReady = true
                        prevDistinctMs = 0
                        lastSentMs = 0
                        lastSentSeq = latestSeq
                    }
                }
                // Kick off the screen stream subscription.
                val frame = rpc.startScreenStream()
                ble?.send(frame)
            }
        }
    }

    private fun onBleBytes(bytes: ByteArray) {
        val msgs = rpc.parseIncoming(bytes)
        for (m in msgs) {
            if (m.contentCase == Flipper.Main.ContentCase.GUI_SCREEN_FRAME) {
                val data = m.guiScreenFrame.data.toByteArray()
                if (data.size != FlipperRpc.EXPECTED_FRAME_BYTES) {
                    Log.w(TAG, "frame size mismatch: ${data.size}")
                    continue
                }
                lifecycleScope.launch(Dispatchers.Default) {
                    handleScreenFrame(data)
                }
            } else {
                Log.d(TAG, "rpc <- cmd=${m.commandId} status=${m.commandStatus} which=${m.contentCase}")
            }
        }
    }

    private suspend fun handleScreenFrame(frame: ByteArray) {
        val hash = blake2bish(frame)
        val now = System.currentTimeMillis()
        val rowMajor = FlipperRpc.flipperToRowMajor(frame)
        var toSend: Pair<Int, ByteArray>? = null
        var holdForSettle = false
        dedupMutex.withLock {
            // Identical screen: nothing to show. (The Flipper streams frames
            // continuously even when the screen is static.)
            if (hash.contentEquals(lastFrameHash)) {
                skipCount++
                return
            }
            val gap = now - prevDistinctMs
            prevDistinctMs = now
            lastFrameHash = hash
            seq++
            latestFrame = rowMajor
            latestSeq = seq
            frameCount++
            // Burst policy (animations): a frame arriving after a quiet gap is
            // a discrete change (button press / single redraw) - send at once.
            // Frames arriving back-to-back are an animation: HOLD them, emit a
            // keyframe at most every KEYFRAME_MS, and let the settle timer
            // flush the final frame when the stream goes quiet. Without this,
            // sustained streams outrun the glasses' display drain rate and lag
            // accumulates inside the Even app's internal queue no matter how
            // the renderer paces itself.
            val canSend = clientReady || now - lastSentMs > ACK_TIMEOUT_MS
            val wantNow = gap >= SETTLE_MS || now - lastSentMs >= KEYFRAME_MS
            if (canSend && wantNow) {
                clientReady = false
                lastSentSeq = latestSeq
                lastSentMs = now
                toSend = latestSeq to rowMajor
            } else {
                skipCount++
                holdForSettle = true
            }
        }
        if (holdForSettle) scheduleSettleFlush()
        toSend?.let { (s, bytes) ->
            Log.i(TAG, "broadcastFrame seq=$s bytes=${bytes.size}")
            wsServer.broadcastFrame(s, bytes)
            broadcastUiCounters()
        }
    }

    /**
     * (Re)arm the settle timer: when no new distinct frame arrives for
     * SETTLE_MS, the stream has gone quiet - flush the held latest frame so
     * the final state of an animation/redraw always lands promptly.
     */
    private fun scheduleSettleFlush() {
        settleJob?.cancel()
        settleJob = lifecycleScope.launch {
            delay(SETTLE_MS)
            var toSend: Pair<Int, ByteArray>? = null
            dedupMutex.withLock {
                val frame = latestFrame
                val now = System.currentTimeMillis()
                if (frame != null && latestSeq != lastSentSeq &&
                    (clientReady || now - lastSentMs > ACK_TIMEOUT_MS)
                ) {
                    clientReady = false
                    lastSentSeq = latestSeq
                    lastSentMs = now
                    toSend = latestSeq to frame
                }
            }
            toSend?.let { (s, bytes) ->
                Log.i(TAG, "settleFlush seq=$s")
                wsServer.broadcastFrame(s, bytes)
                broadcastUiCounters()
            }
        }
    }

    /**
     * The client finished rendering and granted a credit. Ship the freshest
     * unsent frame if the burst policy allows (stream settled, keyframe due,
     * or a button press primed it); otherwise bank the credit - the arrival
     * path sends the next keyframe and the settle timer flushes the final
     * frame, so a mid-animation ack doesn't resume flooding the display.
     */
    private fun onClientReady() {
        lifecycleScope.launch {
            var toSend: Pair<Int, ByteArray>? = null
            dedupMutex.withLock {
                val frame = latestFrame
                val now = System.currentTimeMillis()
                val settled = now - prevDistinctMs >= SETTLE_MS
                val keyframeDue = now - lastSentMs >= KEYFRAME_MS
                if (frame != null && latestSeq != lastSentSeq &&
                    (settled || keyframeDue)
                ) {
                    clientReady = false
                    lastSentSeq = latestSeq
                    lastSentMs = now
                    toSend = latestSeq to frame
                } else {
                    clientReady = true
                }
            }
            toSend?.let { (s, bytes) ->
                wsServer.broadcastFrame(s, bytes)
                broadcastUiCounters()
            }
        }
    }

    private fun handleClientMessage(msg: ClientMessage) {
        when (msg) {
            is ClientMessage.Connect -> {
                Log.i(TAG, "client requested connect (current BLE state=$currentBleState)")
                if (BuildConfig.USE_STUB) {
                    lifecycleScope.launch { wsServer.broadcastStatus("connected", "stub") }
                } else {
                    // If we are already connected or actively connecting, do
                    // not restart the scan. Just re-broadcast current status
                    // so the freshly connected web client knows where we are.
                    val state = currentBleState
                    if (state == FlipperBleClient.State.READY) {
                        lifecycleScope.launch {
                            wsServer.broadcastStatus("connected", null)
                            // Clear the dedup hash so the next incoming BLE frame
                            // is broadcast fresh, and grant an initial credit so
                            // the closed-loop pacing primes. A static screen hashes
                            // identically every time and would otherwise be
                            // suppressed - leaving a newly-connected client staring
                            // at a blank container. (Re-requesting the stream
                            // doesn't help: Flipper rejects it as ALREADY_STARTED.)
                            dedupMutex.withLock {
                                lastFrameHash = ByteArray(0)
                                clientReady = true
                                lastSentSeq = latestSeq
                            }
                        }
                    } else if (state == FlipperBleClient.State.SCANNING ||
                               state == FlipperBleClient.State.CONNECTING ||
                               state == FlipperBleClient.State.DISCOVERING) {
                        lifecycleScope.launch { wsServer.broadcastStatus("scanning", null) }
                    } else {
                        startScanAndConnect()
                    }
                }
            }
            is ClientMessage.Disconnect -> {
                Log.i(TAG, "client requested disconnect")
                ble?.disconnect()
                lifecycleScope.launch { wsServer.broadcastStatus("disconnected", null) }
            }
            is ClientMessage.Button -> {
                Log.i(TAG, "button key=${msg.key} action=${msg.action}")
                routeButton(msg.key, msg.action)
            }
            is ClientMessage.Ready -> {
                onClientReady()
            }
        }
    }

    fun routeButton(key: String, action: String) {
        if (BuildConfig.USE_STUB) return
        // NOTE: do NOT force-send the next frame on input. A Flipper menu
        // scroll is itself a short animation; forcing ships the first
        // half-scrolled frame, wasting the credit, while the settled menu the
        // user actually wants waits a whole render cycle. The settle flush
        // delivers the final frame ~300ms after the scroll ends - that IS the
        // press feedback.
        val chunks = rpc.sendInputEventChunks(key, action)
        if (chunks == null) {
            Log.w(TAG, "bad button $key/$action")
            return
        }
        // Pace PRESS -> RELEASE -> SHORT with ~60ms between writes. Tight
        // bursts get coalesced by the firmware after a key change; ~60ms is
        // the smallest spacing we found reliable while keeping click->action
        // latency at ~120ms per tap.
        val client = ble ?: return
        lifecycleScope.launch {
            for ((i, c) in chunks.withIndex()) {
                client.send(c)
                if (i < chunks.size - 1) delay(60)
            }
        }
    }

    override fun onDestroy() {
        stopBridge()
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    private fun broadcastDeviceInfo(device: BluetoothDevice, rssi: Int) {
        val intent = Intent(ACTION_UI_DEVICE).apply {
            putExtra(EXTRA_DEVICE_NAME, safeName(device) ?: "Flipper")
            putExtra(EXTRA_DEVICE_ADDR, device.address)
            putExtra(EXTRA_RSSI, rssi)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    private fun broadcastUiStatus(state: String, info: String? = null) {
        val intent = Intent(ACTION_UI_STATUS).apply {
            putExtra(EXTRA_STATE, state)
            putExtra(EXTRA_INFO, info)
            putExtra(EXTRA_FRAMES, frameCount)
            putExtra(EXTRA_SKIPS, skipCount)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    /**
     * Counter-only update: refreshes the frames/skips line WITHOUT touching the
     * connection-state line. Frames arrive many times a second; routing them
     * through broadcastUiStatus("frame") was overwriting the real BLE state
     * ("connected") with a meaningless "frame" on every frame, so the UI never
     * showed a stable status. Omitting EXTRA_STATE tells MainActivity to leave
     * the status text alone and update only the counters.
     */
    private fun broadcastUiCounters() {
        val intent = Intent(ACTION_UI_STATUS).apply {
            putExtra(EXTRA_FRAMES, frameCount)
            putExtra(EXTRA_SKIPS, skipCount)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    private fun safeName(device: BluetoothDevice): String? = try {
        device.name
    } catch (_: SecurityException) { null }

    private fun blake2bish(input: ByteArray): ByteArray {
        // Android's bundled JCA lacks Blake2; SHA-256 truncated to 8 bytes is
        // an equivalent collision-resistant content hash for dedup purposes.
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(input).copyOfRange(0, 8)
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.notif_channel_name),
                    NotificationManager.IMPORTANCE_LOW
                )
            )
        }

        val tapIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notif_text))
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setContentIntent(tapIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    companion object {
        private const val TAG = "BridgeService"
        private const val CHANNEL_ID = "flipper_bridge"
        private const val NOTIF_ID = 1

        // Closed-loop pacing fallback: if the client stops acking (`ready`)
        // for this long - a dropped ack, or an older webapp build that doesn't
        // send credits - send the latest frame anyway so the mirror never
        // wedges. MUST be comfortably longer than the slowest real render: a
        // 288x144 updateImageRawData takes ~1.5-3s on real glasses, and a
        // fallback that fires mid-render double-sends into the Even app's
        // internal queue, compounding into multi-second backlog (the 6-7s
        // latency bug). Wedge-breaker only, never a scheduler.
        const val ACK_TIMEOUT_MS: Long = 8000

        // Burst policy: a distinct frame arriving >= SETTLE_MS after the
        // previous one is a discrete change (send immediately); anything
        // tighter is an animation, which is held to one keyframe per
        // KEYFRAME_MS with the settle timer flushing the final frame when the
        // stream goes quiet. Keeps the Even app's display queue at <= 1 frame
        // during animations, so input feedback isn't buried behind stale
        // animation frames.
        const val SETTLE_MS: Long = 300
        const val KEYFRAME_MS: Long = 3000

        const val ACTION_STOP = "com.evenrealities.flipperbridge.STOP"
        const val ACTION_SCAN_CONNECT = "com.evenrealities.flipperbridge.SCAN_CONNECT"
        const val ACTION_DISCONNECT = "com.evenrealities.flipperbridge.DISCONNECT"
        const val ACTION_BUTTON = "com.evenrealities.flipperbridge.BUTTON"
        const val EXTRA_BUTTON_KEY = "key"
        const val EXTRA_BUTTON_ACTION = "action"

        const val ACTION_UI_STATUS = "com.evenrealities.flipperbridge.UI_STATUS"
        const val ACTION_UI_DEVICE = "com.evenrealities.flipperbridge.UI_DEVICE"
        const val EXTRA_STATE = "state"
        const val EXTRA_INFO = "info"
        const val EXTRA_FRAMES = "frames"
        const val EXTRA_SKIPS = "skips"
        const val EXTRA_DEVICE_NAME = "name"
        const val EXTRA_DEVICE_ADDR = "addr"
        const val EXTRA_RSSI = "rssi"

        fun start(ctx: Context) {
            val i = Intent(ctx, BridgeService::class.java)
            ctx.startForegroundService(i)
        }

        fun stop(ctx: Context) {
            val i = Intent(ctx, BridgeService::class.java).apply { action = ACTION_STOP }
            ctx.startService(i)
        }

        fun scanAndConnect(ctx: Context) {
            val i = Intent(ctx, BridgeService::class.java).apply { action = ACTION_SCAN_CONNECT }
            ctx.startService(i)
        }

        fun disconnect(ctx: Context) {
            val i = Intent(ctx, BridgeService::class.java).apply { action = ACTION_DISCONNECT }
            ctx.startService(i)
        }

        fun sendButton(ctx: Context, key: String, action: String) {
            val i = Intent(ctx, BridgeService::class.java).apply {
                this.action = ACTION_BUTTON
                putExtra(EXTRA_BUTTON_KEY, key)
                putExtra(EXTRA_BUTTON_ACTION, action)
            }
            ctx.startService(i)
        }
    }
}
