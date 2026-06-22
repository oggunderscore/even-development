package cc.homeauto.appsbridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

class BridgeService : Service() {

    private var gps:    GpsManager?   = null
    private var server: BridgeServer? = null
    private lateinit var wsServer: WsServer

    private val handler = Handler(Looper.getMainLooper())
    private val sleepRunnable = Runnable { doSleep() }
    private val releaseForegroundRunnable = Runnable { releaseForegroundIfIdle() }
    private val componentRetryRunnable = Runnable { retryRequestedComponents() }
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            android.util.Log.v("AppsBridge", "standby heartbeat")
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    companion object {
        const val PORT            = 7070
        const val WS_PORT         = 7071
        const val CHANNEL_ID      = "appsbridge"
        const val NOTIF_ID        = 1
        const val ACTION_REQUIRE_FOREGROUND = "cc.homeauto.appsbridge.REQUIRE_FOREGROUND_START"
        private const val SLEEP_DELAY_MS = 20_000L
        private const val HEARTBEAT_MS   = 25_000L
        private const val FOREGROUND_BOOTSTRAP_MS = 2_000L
        private const val COMPONENT_RETRY_MS = 3_000L
        private const val GPS_FIRST_FIX_RETRY_MS = 10_000L
    }

    @Volatile private var foregroundActive = false
    private var requestedComponents = emptySet<BridgeComponent>()
    private var gpsStartedAtMs = 0L

    override fun onCreate() {
        super.onCreate()
        createChannel()

        // Start in standby — only the WS server runs until a HUD client connects.
        wsServer = WsServer(WS_PORT).also { ws ->
            ws.onFirstClient = { handler.post { onHudClientConnected() } }
            ws.onClientStateChanged = { handler.post { updateNotification() } }
            ws.onRequestedComponentsChanged = { components -> handler.post { onRequestedComponentsChanged(components) } }
            ws.onLastClient  = { handler.post { onRequestedComponentsChanged(emptySet()) } }
            ws.start()
        }

        SharedState.serverRunning = true
        updateNotification()
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_REQUIRE_FOREGROUND) {
            startOrUpdateForeground(requestedComponents)
            if (requestedComponents.isNotEmpty()) applyRequestedComponents(requestedComponents)
            handler.postDelayed(releaseForegroundRunnable, FOREGROUND_BOOTSTRAP_MS)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(sleepRunnable)
        handler.removeCallbacks(releaseForegroundRunnable)
        handler.removeCallbacks(componentRetryRunnable)
        handler.removeCallbacks(heartbeatRunnable)
        doSleep()
        wsServer.shutdown()
        if (foregroundActive) stopForeground(STOP_FOREGROUND_REMOVE)
        SharedState.serverRunning = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Sleep / wake ──────────────────────────────────────────────────────────

    private fun onHudClientConnected() {
        handler.removeCallbacks(releaseForegroundRunnable)
        startOrUpdateForeground(requestedComponents)
        updateNotification()
    }

    private fun onRequestedComponentsChanged(components: Set<BridgeComponent>) {
        requestedComponents = components
        handler.removeCallbacks(componentRetryRunnable)
        handler.removeCallbacks(sleepRunnable)
        if (components.isEmpty()) {
            scheduleSleep()
        } else {
            applyRequestedComponents(components)
        }
        updateNotification()
    }

    private fun scheduleSleep() {
        handler.removeCallbacks(sleepRunnable)
        handler.postDelayed(sleepRunnable, SLEEP_DELAY_MS)
    }

    private fun applyRequestedComponents(components: Set<BridgeComponent>) {
        android.util.Log.i("AppsBridge", "requested components: " + BridgeComponent.wireValues(components))
        val gpsRequested = components.contains(BridgeComponent.GPS)
        val nonLocationComponents = components - BridgeComponent.GPS

        if (!startOrUpdateForeground(nonLocationComponents)) {
            android.util.Log.w(
                "AppsBridge",
                "foreground promotion pending; starting requested components anyway",
            )
            scheduleComponentRetry(COMPONENT_RETRY_MS)
        }

        setHttpActive(components.contains(BridgeComponent.HTTP))
        setMediaNavActive(
            media = components.contains(BridgeComponent.MEDIA),
            nav = components.contains(BridgeComponent.NAV),
        )
        SharedState.captionsActive = components.contains(BridgeComponent.CAPTIONS)
        SharedState.phoneAudioRequested = components.contains(BridgeComponent.PHONE_AUDIO)
        if (gpsRequested) {
            val locationForegroundReady = startOrUpdateForeground(components)
            val gpsStarted = setGpsActive(true)
            if (!locationForegroundReady) {
                if (!gpsHasFixSinceStart()) SharedState.gpsLastError = "Location foreground pending"
                android.util.Log.w(
                    "AppsBridge",
                    "location foreground pending; GPS listener was requested optimistically",
                )
                scheduleComponentRetry(COMPONENT_RETRY_MS)
            } else if (!gpsStarted) {
                scheduleComponentRetry(COMPONENT_RETRY_MS)
            } else if (!gpsHasFixSinceStart()) {
                scheduleComponentRetry(GPS_FIRST_FIX_RETRY_MS)
            }
        } else {
            setGpsActive(false)
        }
        updateNotification()
    }

    private fun retryRequestedComponents() {
        val components = requestedComponents
        if (components.isEmpty() || !hasConnectedHud()) return
        if (components.contains(BridgeComponent.GPS) && gpsFirstFixTimedOut()) {
            android.util.Log.w("AppsBridge", "GPS listener accepted but no first fix arrived; restarting")
            setGpsActive(false)
        }
        android.util.Log.i("AppsBridge", "retrying requested components: " + BridgeComponent.wireValues(components))
        applyRequestedComponents(components)
    }

    private fun scheduleComponentRetry(delayMs: Long = COMPONENT_RETRY_MS) {
        if (requestedComponents.isEmpty() || !hasConnectedHud()) return
        handler.removeCallbacks(componentRetryRunnable)
        handler.postDelayed(componentRetryRunnable, delayMs)
    }

    private fun setGpsActive(active: Boolean): Boolean {
        if (active == SharedState.gpsActive) return active
        if (!active) {
            gps?.stop(); gps = null
            SharedState.gpsActive = false
            SharedState.gpsLastError = ""
            gpsStartedAtMs = 0L
            return true
        }

        val gpsManager = GpsManager(this)
        if (!gpsManager.start()) {
            gps = null
            SharedState.gpsActive = false
            gpsStartedAtMs = 0L
            updateNotification()
            android.util.Log.w("AppsBridge", "GPS wake aborted: " + SharedState.gpsLastError)
            return false
        }
        gps = gpsManager
        gpsStartedAtMs = System.currentTimeMillis()
        SharedState.gpsActive = true
        return true
    }

    private fun gpsHasFixSinceStart(): Boolean =
        gpsStartedAtMs > 0L && SharedState.gpsLastUpdateMs >= gpsStartedAtMs

    private fun gpsFirstFixTimedOut(): Boolean =
        SharedState.gpsActive &&
            gpsStartedAtMs > 0L &&
            !gpsHasFixSinceStart() &&
            System.currentTimeMillis() - gpsStartedAtMs >= GPS_FIRST_FIX_RETRY_MS

    private fun setHttpActive(active: Boolean) {
        if (active == SharedState.httpActive) return
        if (active) {
            server = BridgeServer(PORT).also { it.start() }
            SharedState.httpActive = true
        } else {
            server?.stop(); server = null
            SharedState.httpActive = false
        }
    }

    private fun setMediaNavActive(media: Boolean, nav: Boolean) {
        val changed = SharedState.mediaActive != media || SharedState.navActive != nav
        SharedState.mediaActive = media
        SharedState.navActive = nav
        if (media || nav) {
            MediaListener.instance?.wakeRefresh()
        } else if (changed) {
            MediaListener.instance?.sleepStop()
        }
    }

    private fun doSleep() {
        android.util.Log.i("AppsBridge", "sleeping - stopping requested components")
        setMediaNavActive(media = false, nav = false)
        setGpsActive(false)
        setHttpActive(false)
        SharedState.captionsActive = false
        SharedState.phoneAudioRequested = false
        SharedState.requestedComponents = ""
        requestedComponents = emptySet()
        handler.removeCallbacks(componentRetryRunnable)
        updateNotification()
        releaseForegroundIfIdle()
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun updateNotification() {
        if (!foregroundActive) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification())
    }

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "APPS Bridge", NotificationManager.IMPORTANCE_LOW)
        ch.description = "GPS and media bridge for homeauto.cc apps"
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun startOrUpdateForeground(components: Set<BridgeComponent> = requestedComponents): Boolean {
        val notification = buildNotification()
        val wasForeground = foregroundActive
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notification, foregroundServiceTypeFor(components))
            } else {
                startForeground(NOTIF_ID, notification)
            }
            foregroundActive = true
            return true
        } catch (e: RuntimeException) {
            foregroundActive = wasForeground
            android.util.Log.w(
                "AppsBridge",
                "foreground promotion rejected; components not enabled: ${e.message}",
            )
        }
        return false
    }

    private fun foregroundServiceTypeFor(components: Set<BridgeComponent>): Int {
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (components.contains(BridgeComponent.GPS) || SharedState.gpsActive) {
            type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        }
        return type
    }

    private fun releaseForegroundIfIdle() {
        if (!foregroundActive || hasConnectedHud()) return
        stopForeground(STOP_FOREGROUND_REMOVE)
        foregroundActive = false
    }

    private fun hasConnectedHud(): Boolean = (wsServer.clientCount() > 0)

    private fun activeHudLabel(): String = wsServer.activeModuleLabel().ifEmpty {
        if (SharedState.ccCapturing || SharedState.captionsActive) "CC Live" else "HUD"
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("APPS Bridge")
        .setContentText(
            when {
                SharedState.gpsActive || SharedState.httpActive || SharedState.mediaActive || SharedState.navActive -> "Active - ${activeHudLabel()}"
                SharedState.ccCapturing || SharedState.captionsActive -> "Active - ${activeHudLabel()}"
                hasConnectedHud() -> "Connected - ${activeHudLabel()}"
                else -> "Standby"
            }
        )
        .setSmallIcon(android.R.drawable.ic_menu_compass)
        .setOngoing(true)
        .setContentIntent(
            PendingIntent.getActivity(
                this, 0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE
            )
        )
        .build()
}
