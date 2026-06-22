package cc.homeauto.appsbridge

import android.app.Notification
import android.content.ComponentName
import android.media.AudioManager
import java.util.UUID
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.view.KeyEvent

class MediaListener : NotificationListenerService() {

    private var controller: MediaController? = null

    // Periodic nav scan — catches Maps updating its notification silently
    private val navHandler  = Handler(Looper.getMainLooper())
    private val inactiveNavMessageRunnable = Runnable {
        if (!SharedState.navRouteActive) setInactiveNavMessage()
    }
    private val navRunnable = object : Runnable {
        override fun run() {
            scanActiveNavNotifications()
            navHandler.postDelayed(this, NAV_SCAN_MS)
        }
    }

    companion object {
        @Volatile var instance: MediaListener? = null

        private const val NAV_SCAN_MS = 2000L
        private const val ARRIVAL_INACTIVE_DELAY_MS = 10_000L
        private const val NO_ACTIVE_NAV = "No active Navigation"

        // Packages that carry direct-message notifications
        private val MESSAGE_PACKAGES = setOf(
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.whatsapp",
            "com.facebook.orca",
            "org.thoughtcrime.securesms",   // Signal
            "com.instagram.android",
            "com.snapchat.android",
        )

        private val MESSAGE_APP_NAMES = mapOf(
            "com.google.android.apps.messaging" to "Messages",
            "com.samsung.android.messaging"     to "Messages",
            "com.android.mms"                   to "Messages",
            "com.whatsapp"                      to "WhatsApp",
            "com.facebook.orca"                 to "Messenger",
            "org.thoughtcrime.securesms"        to "Signal",
            "com.instagram.android"             to "Instagram",
            "com.snapchat.android"              to "Snapchat",
        )

        // Packages whose active notifications carry turn-by-turn nav data
        private val NAV_PACKAGES = setOf(
            "com.google.android.apps.maps",
            "com.waze",
            "net.osmand",
            "net.osmand.plus",
            "com.sygic.aura",
        )

        // Matches a distance value embedded in text ("in 200 m", "in 0.3 mi", "500 ft")
        private val DISTANCE_RE = Regex(
            """\b\d+(?:[.,]\d+)?\s*(?:ft|mi\b|m\b|km\b|meter|metre|mile|foot|feet)\b""",
            RegexOption.IGNORE_CASE
        )

        // Matches "in <distance>" phrasing so we can split instruction from embedded distance
        private val IN_DISTANCE_RE = Regex(
            """\s+in\s+\d+(?:[.,]\d+)?\s*(?:ft|mi\b|m\b|km\b|meter|metre|mile|foot|feet)\b.*$""",
            RegexOption.IGNORE_CASE
        )

        // App-name placeholders some nav apps put in EXTRA_TITLE instead of the instruction
        private val APP_NAME_RE = Regex(
            """^(google\s+maps?|waze|maps?|navigation|osmand|sygic)$""",
            RegexOption.IGNORE_CASE
        )

        // Direction keywords — identifies which field carries the turn instruction
        private val DIRECTION_RE = Regex(
            """\b(turn|keep|exit|merge|ramp|roundabout|continue|straight|head|arrive|u.?turn|bear|slight)\b""",
            RegexOption.IGNORE_CASE
        )

        // End-of-route copy varies by nav app and Android notification style.
        private val ARRIVAL_RE = Regex(
            """\b(arrived|you have arrived|destination reached|route complete|navigation ended|ended route|end route|trip complete)\b|^arriv(?:e|ing)\s+at\b""",
            RegexOption.IGNORE_CASE
        )

        // Detects Maps-style "distance • instruction" combined title: "2.3 mi • Slight left onto Baker St"
        private val DIST_LEAD_RE = Regex(
            """^(\d+(?:[.,]\d+)?\s*(?:ft|mi\b|m\b|km\b))\s*[•·*|]\s*(.+)$""",
            RegexOption.IGNORE_CASE
        )

        // Matches a time of day for ETA extraction ("2:30 PM", "14:30")
        private val ETA_RE = Regex(
            """\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b""",
            RegexOption.IGNORE_CASE
        )
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        sleepStop()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        if (SharedState.mediaActive || SharedState.navActive) wakeRefresh()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (SharedState.notificationsActive && sbn != null) maybePostMessage(sbn)
        if (!SharedState.mediaActive && !SharedState.navActive) return
        if (SharedState.mediaActive) refresh()
        // Scan ALL active notifications — Maps sometimes updates its notification
        // in-place without the posted SBN being the nav notification itself.
        if (SharedState.navActive) scanActiveNavNotifications()
    }

    private fun maybePostMessage(sbn: StatusBarNotification) {
        if (sbn.packageName !in MESSAGE_PACKAGES) return
        val extras = sbn.notification?.extras ?: return
        val from = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: return
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: return
        if (from.isEmpty() || body.isEmpty()) return

        // Skip group summary notifications (no user-visible body)
        if (sbn.notification?.flags?.and(Notification.FLAG_GROUP_SUMMARY) != 0) return

        val app = MESSAGE_APP_NAMES[sbn.packageName] ?: sbn.packageName
        val replyable = sbn.notification?.actions?.any { action ->
            action.semanticAction == android.app.Notification.Action.SEMANTIC_ACTION_REPLY ||
            action.remoteInputs?.isNotEmpty() == true
        } ?: false

        // Use the notification key as a stable way to track it for reply
        val id = UUID.randomUUID().toString()
        if (replyable) ReplyManager.register(id, sbn)

        android.util.Log.d("AppsBridge/Notif", "message from=$from app=$app replyable=$replyable")
        WsServer.instance?.broadcastNotification(
            id = id,
            app = app,
            from = from,
            body = body,
            phone = "",   // Android doesn't reliably expose the phone number via notification extras
            replyable = replyable,
        )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (!SharedState.mediaActive && !SharedState.navActive) return
        if (SharedState.mediaActive) refresh()
        sbn ?: return
        if (sbn.packageName in NAV_PACKAGES) {
            // Confirm it's truly gone before clearing — Maps can remove + re-add rapidly
            val stillActive = try {
                activeNotifications?.any { it.packageName in NAV_PACKAGES } == true
            } catch (_: Exception) { false }
            if (!stillActive) clearNav()
        }
    }

    /** Called by BridgeService.doWake() to restart scanning after standby. */
    fun wakeRefresh() {
        refresh()
        scanActiveNavNotifications()
        navHandler.removeCallbacks(navRunnable)
        navHandler.postDelayed(navRunnable, NAV_SCAN_MS)
    }

    /** Called by BridgeService.doSleep() to stop scanning during standby. */
    fun sleepStop() {
        navHandler.removeCallbacks(navRunnable)
        navHandler.removeCallbacks(inactiveNavMessageRunnable)
        controller?.unregisterCallback(callback)
        controller = null
    }

    // ── Media ─────────────────────────────────────────────────────────────────

    private fun refresh() {
        try {
            val mgr = getSystemService(MEDIA_SESSION_SERVICE) as MediaSessionManager
            val sessions = mgr.getActiveSessions(ComponentName(this, MediaListener::class.java))
            controller?.unregisterCallback(callback)
            controller = sessions.firstOrNull()
            controller?.registerCallback(callback)
            syncState()
        } catch (_: Exception) {}
    }

    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = syncState()
        override fun onPlaybackStateChanged(state: PlaybackState?) = syncState()
    }

    private fun syncState() {
        if (!SharedState.mediaActive) return
        val c = controller
        if (c == null) {
            SharedState.mediaStatus = "unknown"
            BridgeServer.instance?.broadcastMedia()
            WsServer.instance?.broadcastMedia()
            return
        }
        val meta = c.metadata
        SharedState.mediaTitle  = meta?.getString(MediaMetadata.METADATA_KEY_TITLE)  ?: ""
        SharedState.mediaArtist = meta?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: ""
        SharedState.mediaStatus = when (c.playbackState?.state) {
            PlaybackState.STATE_PLAYING -> "playing"
            PlaybackState.STATE_PAUSED  -> "paused"
            else                        -> "unknown"
        }
        BridgeServer.instance?.broadcastMedia()
        WsServer.instance?.broadcastMedia()
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    /** Scan all currently shown notifications and update nav state from the first nav app found. */
    private fun scanActiveNavNotifications() {
        if (!SharedState.navActive) return
        try {
            val navSbn = activeNotifications?.firstOrNull { it.packageName in NAV_PACKAGES }
            if (navSbn != null) updateNav(navSbn)
            else clearNav()
        } catch (_: Exception) {}
    }

    private fun updateNav(sbn: StatusBarNotification) {
        val extras   = sbn.notification?.extras ?: return
        val title    = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()    ?: ""
        val text     = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()     ?: ""
        val bigText  = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""
        val subText  = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim() ?: ""
        val infoText = extras.getCharSequence("android.infoText")?.toString()?.trim()          ?: ""
        val ticker   = sbn.notification?.tickerText?.toString()?.trim()                        ?: ""

        // Always store raw extras for /debug/nav
        SharedState.navDebugPkg   = sbn.packageName
        SharedState.navDebugTitle = title
        SharedState.navDebugText  = text
        SharedState.navDebugBig   = bigText
        SharedState.navDebugSub   = subText

        android.util.Log.d("AppsBridge/Nav",
            "pkg=${sbn.packageName} title='$title' text='$text' big='$bigText' sub='$subText' info='$infoText' ticker='$ticker'")

        // ── Android 16+ defensive instruction extraction ──────────────────────
        // Live-update notifications may carry instruction in any text field.
        // Check title first for Maps-style "distance • instruction" combined format,
        // then prefer the field containing a direction keyword.
        val instruction: String
        val distance: String

        val distLeadMatch = DIST_LEAD_RE.find(title)
        if (distLeadMatch != null) {
            // Title = "2.3 mi • Slight left onto Baker St" — split on separator
            distance    = distLeadMatch.groupValues[1].trim()
            instruction = distLeadMatch.groupValues[2].trim()
        } else {
            val candidates = listOf(text, bigText, ticker, title, infoText)
                .map { it.trim() }
                .filter { it.isNotEmpty() && !APP_NAME_RE.matches(it) }

            val instructionRaw = candidates.firstOrNull { DIRECTION_RE.containsMatchIn(it) }
                ?: candidates.firstOrNull()
                ?: run {
                    clearNav()
                    return
                }

            // Maps sometimes embeds distance inline: "Turn right in 200 m"
            val inlineDistMatch = IN_DISTANCE_RE.find(instructionRaw)
            if (inlineDistMatch != null) {
                instruction = instructionRaw.substring(0, inlineDistMatch.range.first).trim()
                distance    = DISTANCE_RE.find(inlineDistMatch.value)?.value ?: ""
            } else {
                instruction = instructionRaw
                val distSource = candidates.firstOrNull { it != instructionRaw && DISTANCE_RE.containsMatchIn(it) }
                distance = if (distSource != null) DISTANCE_RE.find(distSource)?.value ?: "" else ""
            }
        }

        // ── ETA extraction ────────────────────────────────────────────────────
        // Scan subText, infoText, ticker in order — first field containing a time wins
        val etaSource = listOf(subText, infoText, ticker, text)
            .firstOrNull { ETA_RE.containsMatchIn(it) } ?: ""
        val etaTime = ETA_RE.find(etaSource)?.groupValues?.get(1) ?: ""
        val eta     = if (etaTime.isNotEmpty()) "Arrive $etaTime" else ""

        android.util.Log.d("AppsBridge/Nav",
            "parsed: instruction='$instruction' distance='$distance' eta='$eta'")

        if (instruction.isNotEmpty()) {
            if (isArrivalInstruction(instruction)) {
                setArrivedNav(instruction)
            } else {
                setActiveNav(instruction, distance, eta, extractNavIcon(sbn.notification!!))
            }
        }
    }

    private fun isArrivalInstruction(instruction: String): Boolean =
        ARRIVAL_RE.containsMatchIn(instruction.trim())

    private fun setActiveNav(instruction: String, distance: String, eta: String, icon: String) {
        navHandler.removeCallbacks(inactiveNavMessageRunnable)
        SharedState.navRouteActive = true
        SharedState.navInstruction = instruction
        SharedState.navDistance    = distance
        SharedState.navEta         = eta
        SharedState.navIcon        = icon
        publishNav()
    }

    private fun setArrivedNav(message: String) {
        if (!SharedState.navRouteActive &&
            (SharedState.navInstruction == message || SharedState.navInstruction == NO_ACTIVE_NAV)) {
            return
        }
        navHandler.removeCallbacks(inactiveNavMessageRunnable)
        SharedState.navRouteActive = false
        SharedState.navInstruction = message
        SharedState.navDistance    = ""
        SharedState.navEta         = ""
        SharedState.navIcon        = ""
        publishNav()
        navHandler.postDelayed(inactiveNavMessageRunnable, ARRIVAL_INACTIVE_DELAY_MS)
    }

    private fun setInactiveNavMessage() {
        if (!SharedState.navRouteActive &&
            SharedState.navInstruction == NO_ACTIVE_NAV &&
            SharedState.navDistance.isEmpty() &&
            SharedState.navEta.isEmpty()) {
            return
        }
        SharedState.navRouteActive = false
        SharedState.navInstruction = NO_ACTIVE_NAV
        SharedState.navDistance    = ""
        SharedState.navEta         = ""
        SharedState.navIcon        = ""
        publishNav()
    }

    private fun clearNav() {
        navHandler.removeCallbacks(inactiveNavMessageRunnable)
        setInactiveNavMessage()
    }

    private fun publishNav() {
        BridgeServer.instance?.broadcastNav()
        WsServer.instance?.broadcastNav()
    }

    private fun extractNavIcon(@Suppress("UNUSED_PARAMETER") notification: Notification): String {
        // Turn icon is embedded in Maps' RemoteViews — not accessible via standard APIs.
        // Returning "" so HUD falls back to canvas-rendered arrows.
        return ""
    }

    // ── Media commands ────────────────────────────────────────────────────────

    fun sendCommand(cmd: String) {
        val t = controller?.transportControls
        if (t != null) {
            when (cmd) {
                "play"  -> t.play()
                "pause" -> t.pause()
                "next"  -> t.skipToNext()
                "prev"  -> t.skipToPrevious()
            }
            android.util.Log.d("AppsBridge", "sendCommand via transportControls: $cmd")
        }
        val keycode = when (cmd) {
            "play"  -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "next"  -> KeyEvent.KEYCODE_MEDIA_NEXT
            "prev"  -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else    -> return
        }
        try {
            val am = getSystemService(AUDIO_SERVICE) as AudioManager
            am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keycode))
            am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keycode))
            android.util.Log.d("AppsBridge", "sendCommand via AudioManager: $cmd keycode=$keycode")
        } catch (e: Exception) {
            android.util.Log.w("AppsBridge", "AudioManager dispatch failed for $cmd: ${e.message}")
        }
    }
}
