package cc.homeauto.appsbridge

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.drawable.GradientDrawable
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var rootScroll:     View
    private lateinit var tvVersion:      TextView
    private lateinit var dotStatus:      View
    private lateinit var tvStatus:       TextView
    private lateinit var tvStatusHint:   TextView
    private lateinit var btnBridge:      Button
    private lateinit var btnNotif:       Button
    private lateinit var btnBattery:     Button
    private lateinit var btnThemeAuto:   Button
    private lateinit var btnThemeLight:  Button
    private lateinit var btnThemeDark:   Button
    private lateinit var headerModules:  LinearLayout
    private lateinit var arrowModules:   TextView
    private lateinit var contentModules: LinearLayout
    private lateinit var dotHud:         View
    private lateinit var tvModuleHud:    TextView
    private lateinit var dotCcLive:      View
    private lateinit var tvCcStatus:     TextView
    private lateinit var headerData:     LinearLayout
    private lateinit var arrowData:      TextView
    private lateinit var contentData:    LinearLayout
    private lateinit var tvGps:          TextView
    private lateinit var tvMedia:        TextView
    private lateinit var tvNav:          TextView
    private lateinit var tvAbout:        TextView
    private lateinit var etDeepgramKey:  EditText
    private lateinit var btnSaveDeepgram: Button
    private lateinit var tvDeepgramStatus: TextView
    private lateinit var dotNotifWs:     View
    private lateinit var tvNotifWs:      TextView
    private lateinit var btnTestNotif:   Button
    private lateinit var etTestPhone:    EditText

    private val handler = Handler(Looper.getMainLooper())
    private val mediaProjectionLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            LiveCaptionSender.error("Phone Audio requires Android 10 or newer", CaptionMode.PHONE_AUDIO)
            return@registerForActivityResult
        }
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            LiveCaptionSender.error("Audio capture permission required", CaptionMode.PHONE_AUDIO)
            return@registerForActivityResult
        }
        try {
            PhoneAudioCaptureService.start(this, result.resultCode, result.data!!)
        } catch (e: Exception) {
            LiveCaptionSender.error(
                "Phone Audio capture failed: ${e.message ?: e.javaClass.simpleName}",
                CaptionMode.PHONE_AUDIO,
            )
        }
    }
    private val tick = object : Runnable {
        override fun run() { updateUi(); handler.postDelayed(this, 1000) }
    }
    private val updateCheck = object : Runnable {
        override fun run() { UpdateChecker.check(this@MainActivity); handler.postDelayed(this, 5 * 60 * 1000L) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        applySavedTheme(this)
        super.onCreate(savedInstanceState)
        delegate.localNightMode = delegateModeFor(savedTheme(this))
        setContentView(R.layout.activity_main)

        rootScroll     = findViewById(R.id.root_scroll)
        tvVersion      = findViewById(R.id.tv_version)
        dotStatus      = findViewById(R.id.dot_status)
        tvStatus       = findViewById(R.id.tv_status)
        tvStatusHint   = findViewById(R.id.tv_status_hint)
        btnBridge      = findViewById(R.id.btn_bridge)
        btnNotif       = findViewById(R.id.btn_notif)
        btnBattery     = findViewById(R.id.btn_battery)
        btnThemeAuto   = findViewById(R.id.btn_theme_auto)
        btnThemeLight  = findViewById(R.id.btn_theme_light)
        btnThemeDark   = findViewById(R.id.btn_theme_dark)
        headerModules  = findViewById(R.id.header_modules)
        arrowModules   = findViewById(R.id.arrow_modules)
        contentModules = findViewById(R.id.content_modules)
        dotHud         = findViewById(R.id.dot_hud)
        tvModuleHud    = findViewById(R.id.tv_module_hud)
        dotCcLive      = findViewById(R.id.dot_cc_live)
        tvCcStatus     = findViewById(R.id.tv_cc_status)
        headerData     = findViewById(R.id.header_data)
        arrowData      = findViewById(R.id.arrow_data)
        contentData    = findViewById(R.id.content_data)
        tvGps           = findViewById(R.id.tv_gps)
        tvMedia         = findViewById(R.id.tv_media)
        tvNav           = findViewById(R.id.tv_nav)
        tvAbout         = findViewById(R.id.tv_about)
        etDeepgramKey   = findViewById(R.id.et_deepgram_key)
        btnSaveDeepgram = findViewById(R.id.btn_save_deepgram)
        tvDeepgramStatus= findViewById(R.id.tv_deepgram_status)
        dotNotifWs      = findViewById(R.id.dot_notif_ws)
        tvNotifWs       = findViewById(R.id.tv_notif_ws)
        btnTestNotif    = findViewById(R.id.btn_test_notif)
        etTestPhone     = findViewById(R.id.et_test_phone)
        etTestPhone.setText(prefs().getString(PREF_TEST_PHONE, "") ?: "")

        val version = packageManager.getPackageInfo(packageName, 0).versionName
        tvVersion.text = "v$version"
        tvAbout.text   = "v$version · homeauto.cc\nProvides GPS, media and navigation data to wearable apps."

        btnBridge.setOnClickListener { toggleBridge() }
        btnNotif.setOnClickListener  { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        btnBattery.setOnClickListener { requestBatteryExemption() }
        btnThemeAuto.setOnClickListener  { setPhoneTheme(THEME_AUTO) }
        btnThemeLight.setOnClickListener { setPhoneTheme(THEME_LIGHT) }
        btnThemeDark.setOnClickListener  { setPhoneTheme(THEME_DARK) }
        btnSaveDeepgram.setOnClickListener { saveDeepgramKey() }
        btnTestNotif.setOnClickListener { sendTestNotification() }
        setupPhoneAudioBridge()

        headerModules.setOnClickListener { toggleSection(contentModules, arrowModules) }
        headerData.setOnClickListener    { toggleSection(contentData, arrowData) }

        current = this
        ensureLocationPermission()
        ensureNotificationPermission()
        applyThemeSelectionUi()
        applyPhonePalette(rootScroll)
        applySystemBars()
    }

    override fun onResume() {
        super.onResume()
        applyThemeSelectionUi()
        applyPhonePalette(rootScroll)
        applySystemBars()
        handler.post(tick)
        handler.post(updateCheck)
    }
    override fun onPause()  { super.onPause();  handler.removeCallbacks(tick); handler.removeCallbacks(updateCheck) }
    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    private fun toggleSection(content: LinearLayout, arrow: TextView) {
        val expanding = content.visibility == View.GONE
        content.visibility = if (expanding) View.VISIBLE else View.GONE
        arrow.text = if (expanding) "▾" else "▸"
    }

    private fun toggleBridge() {
        val svc = Intent(this, BridgeService::class.java)
        if (SharedState.serverRunning) stopService(svc)
        else startService(svc)
    }

    private fun setPhoneTheme(theme: String) {
        prefs().edit().putString(PREF_THEME, theme).apply()
        val mode = delegateModeFor(theme)
        AppCompatDelegate.setDefaultNightMode(mode)
        delegate.localNightMode = mode
        applyThemeSelectionUi()
        recreate()
    }

    private fun applyThemeSelectionUi() {
        val selected = prefs().getString(PREF_THEME, THEME_AUTO) ?: THEME_AUTO
        setThemeButton(btnThemeAuto, selected == THEME_AUTO)
        setThemeButton(btnThemeLight, selected == THEME_LIGHT)
        setThemeButton(btnThemeDark, selected == THEME_DARK)
    }

    private fun setThemeButton(btn: Button, selected: Boolean) {
        btn.backgroundTintList = null
        if (selected) {
            btn.setBackgroundResource(R.drawable.even_segmented_item_selected_bg)
            btn.setTextColor(color(R.color.app_text))
            btn.elevation = 2f
        } else {
            btn.setBackgroundResource(R.drawable.even_segmented_item_bg)
            btn.setTextColor(color(R.color.app_text_dim))
            btn.elevation = 0f
        }
    }

    private fun setupPhoneAudioBridge() {
        // Capture is controlled from the G2 WebView and runs in PhoneAudioCaptureService.
    }

    private fun requestPhoneAudioCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            LiveCaptionSender.error("Phone Audio requires Android 10 or newer", CaptionMode.PHONE_AUDIO)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
            return
        }
        val mgr = getSystemService(MediaProjectionManager::class.java)
        mediaProjectionLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun startPhoneAudioFromClientUi() {
        requestPhoneAudioCapture()
    }

    private fun stopPhoneAudioFromClientUi(reason: String) {
        PhoneAudioCaptureService.stop(this, reason)
    }

    private fun stopCaptions(reason: String) {
        PhoneAudioCaptureService.stop(this, reason)
    }

    private fun updateUi() {
        val running = SharedState.serverRunning
        val activeModule = WsServer.instance?.activeStreamingLabel() ?: ""
        val active  = activeModule.isNotEmpty()
        val connectedModule = WsServer.instance?.activeModuleLabel()
            ?: SharedState.wsActiveModuleLabel

        // ── Status card ────────────────────────────────────────────────────────
        setDotColor(dotStatus, when {
            !running -> COLOR_GREY
            active   -> COLOR_GREEN
            else     -> COLOR_AMBER
        })

        tvStatus.text = when {
            !running -> "Stopped"
            active   -> "Active - $activeModule"
            else     -> "Standby — waiting for HUD"
        }

        tvStatus.setTextColor(when {
            !running -> color(R.color.app_text_dim)
            active   -> color(R.color.app_positive)
            else     -> color(R.color.app_text)
        })

        tvStatusHint.text = when {
            !running ->
                "Tap Start to begin. The bridge uses almost no battery while idle — " +
                "GPS wakes automatically when a HUD connects."
            active   ->
                "$activeModule is streaming on WebSocket :${BridgeService.WS_PORT}."
            else     ->
                "Waiting for a HUD app on port ${BridgeService.WS_PORT}. " +
                "GPS is off to save battery — it starts automatically when your HUD connects."
        }

        btnBridge.text = if (running) "Stop" else "Start"
        btnBridge.backgroundTintList = null
        if (running) {
            btnBridge.setBackgroundResource(R.drawable.even_button_danger_bg)
            btnBridge.setTextColor(color(R.color.app_negative))
        } else {
            btnBridge.setBackgroundResource(R.drawable.even_button_highlight_bg)
            btnBridge.setTextColor(color(R.color.app_accent_text))
        }

        // ── Setup card ─────────────────────────────────────────────────────────
        val notifGranted   = isNotifListenerEnabled()
        val batteryExempt  = isBatteryExempt()

        setPermissionButton(btnNotif, notifGranted)
        setPermissionButton(btnBattery, batteryExempt)

        // ── Notifications card ─────────────────────────────────────────────────
        val deepgramKey = prefs().getString(DeepgramProxy.KEY_API_KEY, "") ?: ""
        tvDeepgramStatus.text = if (deepgramKey.isNotEmpty()) "✓ API key saved" else "No key set — voice replies disabled"
        tvDeepgramStatus.setTextColor(
            if (deepgramKey.isNotEmpty()) color(R.color.app_positive) else color(R.color.app_text_dim)
        )

        val wsClients2 = WsServer.instance?.clientCount() ?: 0
        setDotColor(dotNotifWs, when {
            !running       -> COLOR_GREY
            wsClients2 > 0 -> COLOR_GREEN
            else           -> COLOR_AMBER
        })
        tvNotifWs.text = when {
            !running       -> "Bridge stopped — tap Start above"
            wsClients2 > 0 -> "$wsClients2 G2 client${if (wsClients2 == 1) "" else "s"} connected"
            else           -> "Waiting for G2 glasses…"
        }
        btnTestNotif.isEnabled = running && wsClients2 > 0

        // ── Modules card ───────────────────────────────────────────────────────
        val wsClients = WsServer.instance?.clientCount() ?: 0
        val wsLine    = if (running) {
            if (wsClients > 0) "WS :${BridgeService.WS_PORT}    $wsClients client${if (wsClients == 1) "" else "s"}"
            else               "WS :${BridgeService.WS_PORT}    standby"
        } else {
            "WS :${BridgeService.WS_PORT}    off"
        }
        val httpLine = when {
            SharedState.httpActive -> "HTTP :${BridgeService.PORT}  active"
            running -> "HTTP :${BridgeService.PORT}  standby"
            else    -> "HTTP :${BridgeService.PORT}  off"
        }
        val gpsLine = when {
            SharedState.gpsActive && SharedState.gpsLat != null -> "GPS         fix acquired"
            SharedState.gpsActive                               -> "GPS         on, no fix yet"
            SharedState.gpsLastError.isNotEmpty()                -> "GPS         " + SharedState.gpsLastError
            else                                                -> "GPS         off"
        }
        tvModuleHud.text = "$wsLine\n$httpLine\n$gpsLine"
        tvCcStatus.text = listOf(
            "source   android_media",
            "capture  ${if (SharedState.ccCapturing) "active" else "idle"}",
            "engine   ${SharedState.ccEngine}",
            "clients  $wsClients",
            "note     Some apps may block audio capture. Phone calls are not supported.",
        ).joinToString("\n")

        setDotColor(dotHud, when {
            connectedModule == "MotoHUD" && SharedState.gpsActive -> COLOR_GREEN
            running                   -> COLOR_AMBER
            else                      -> COLOR_GREY
        })
        setDotColor(dotCcLive, when {
            SharedState.ccCapturing -> COLOR_GREEN
            running                   -> COLOR_AMBER
            else                      -> COLOR_GREY
        })

        // ── Live data panels ───────────────────────────────────────────────────
        val spd = SharedState.gpsSpeed * 3.6f
        tvGps.text = listOf(
            "speed    ${"%.1f".format(spd)} km/h  ·  ${"%.1f".format(spd * 0.621371f)} mph",
            "heading  ${SharedState.gpsHeading?.let { "${"%.0f".format(it)}°" } ?: "--"}",
            "lat      ${SharedState.gpsLat?.let { "%.5f".format(it) } ?: "--"}",
            "lng      ${SharedState.gpsLng?.let { "%.5f".format(it) } ?: "--"}",
            "accuracy ${SharedState.gpsAccuracy?.let { "${"%.0f".format(it)} m" } ?: "--"}",
            "status   ${if (SharedState.gpsLastError.isEmpty()) "ok" else SharedState.gpsLastError}",
        ).joinToString("\n")

        tvMedia.text = listOf(
            "title    ${SharedState.mediaTitle.ifEmpty  { "--" }}",
            "artist   ${SharedState.mediaArtist.ifEmpty { "--" }}",
            "status   ${SharedState.mediaStatus}",
        ).joinToString("\n")

        tvNav.text = listOf(
            "active   ${if (SharedState.navRouteActive) "yes" else "no"}",
            "instr    ${SharedState.navInstruction.ifEmpty { "--" }}",
            "dist     ${SharedState.navDistance.ifEmpty    { "--" }}",
            "─── raw ──────────────────────",
            "pkg      ${SharedState.navDebugPkg.ifEmpty   { "--" }}",
            "title    ${SharedState.navDebugTitle.ifEmpty { "--" }}",
            "text     ${SharedState.navDebugText.ifEmpty  { "--" }}",
            "big      ${SharedState.navDebugBig.ifEmpty   { "--" }}",
            "sub      ${SharedState.navDebugSub.ifEmpty   { "--" }}",
        ).joinToString("\n")
    }

    private fun saveDeepgramKey() {
        val key = etDeepgramKey.text.toString().trim()
        if (key.isEmpty()) return
        prefs().edit().putString(DeepgramProxy.KEY_API_KEY, key).apply()
        etDeepgramKey.text.clear()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(etDeepgramKey.windowToken, 0)
        updateUi()
    }

    private fun sendTestNotification() {
        val phone = etTestPhone.text.toString().trim()
        prefs().edit().putString(PREF_TEST_PHONE, phone).apply()
        WsServer.instance?.broadcastNotification(
            id        = "test-${System.currentTimeMillis()}",
            app       = "Messages",
            from      = "APPS Bridge",
            body      = "Test message — voice reply is working!",
            phone     = phone,
            replyable = true,
        )
    }

    private fun setPermissionButton(btn: Button, granted: Boolean) {
        if (granted) {
            btn.text = "✓"
            btn.isEnabled = false
            btn.backgroundTintList = null
            btn.setBackgroundResource(R.drawable.even_badge_positive_bg)
            btn.setTextColor(color(R.color.app_positive))
        } else {
            btn.text = "Grant"
            btn.isEnabled = true
            btn.backgroundTintList = null
            btn.setBackgroundResource(R.drawable.even_button_secondary_bg)
            btn.setTextColor(color(R.color.app_text_dim))
        }
        // Battery button has different grant label
        if (btn.id == R.id.btn_battery && !granted) btn.text = "Enable"
    }

    private fun color(id: Int): Int = ContextCompat.getColor(this, id)

    private fun setDotColor(view: View, color: Int) {
        (view.background as? GradientDrawable)?.setColor(color)
    }

    private fun isNotifListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(ComponentName(this, MediaListener::class.java).flattenToString())
    }

    private fun isBatteryExempt(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestBatteryExemption() {
        if (!isBatteryExempt()) {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName")
                )
            )
        }
    }

    private fun ensureLocationPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 1
            )
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) return
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_POST_NOTIFICATIONS,
        )
    }

    private fun applyPhonePalette(view: View) {
        val bg = view.background
        if (view.id == R.id.root_scroll) view.setBackgroundColor(color(R.color.app_bg))
        if (bg is GradientDrawable && view.id !in setOf(R.id.dot_status, R.id.dot_hud, R.id.dot_cc_live, R.id.dot_notif_ws)) {
            if (view is TextView && view.typeface?.isBold == true) {
                bg.setColor(color(R.color.app_surface_light))
            }
        }
        when (view) {
            is Button -> {
                view.stateListAnimator = null
                if (view.id !in setOf(R.id.btn_bridge, R.id.btn_notif, R.id.btn_battery, R.id.btn_theme_auto, R.id.btn_theme_light, R.id.btn_theme_dark)) {
                    view.backgroundTintList = null
                    view.setBackgroundResource(R.drawable.even_button_secondary_bg)
                    view.setTextColor(color(R.color.app_text))
                }
            }
            is TextView -> {
                val current = view.currentTextColor
                view.setTextColor(
                    when (current) {
                        0xFFf0ebe3.toInt(), 0xFFeeeeee.toInt(), 0xFF232323.toInt() -> color(R.color.app_text)
                        0xFF8a7f72.toInt(), 0xFFa8a8a8.toInt(), 0xFF7b7b7b.toInt() -> color(R.color.app_text_dim)
                        0xFF5c5347.toInt(), 0xFF675f55.toInt() -> color(R.color.app_text_muted)
                        0xFF3a342c.toInt(), 0xFF2a2420.toInt(), 0xFFa79d91.toInt() -> color(R.color.app_text_faint)
                        else -> current
                    }
                )
            }
        }
        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) applyPhonePalette(view.getChildAt(i))
        }
    }

    @Suppress("DEPRECATION")
    private fun applySystemBars() {
        window.statusBarColor = color(R.color.app_bg)
        window.navigationBarColor = color(R.color.app_bg)

        val lightBars = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) !=
            Configuration.UI_MODE_NIGHT_YES
        var flags = window.decorView.systemUiVisibility
        flags = if (lightBars) flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        else flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = if (lightBars) flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            else flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
        }
        window.decorView.systemUiVisibility = flags
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) requestPhoneAudioCapture()
            else LiveCaptionSender.error("Audio capture permission required", CaptionMode.PHONE_AUDIO)
        }
    }

    companion object {
        private val COLOR_GREEN = 0xFF4BB956.toInt()
        private val COLOR_AMBER = 0xFFFEF991.toInt()
        private val COLOR_GREY  = 0xFF7B7B7B.toInt()
        private const val REQUEST_RECORD_AUDIO = 42
        private const val REQUEST_POST_NOTIFICATIONS = 43
        private const val PREFS = "appsbridge_prefs"
        private const val PREF_THEME = "phone_theme"
        private const val PREF_TEST_PHONE = "test_phone_number"
        private const val THEME_AUTO = "auto"
        private const val THEME_LIGHT = "light"
        private const val THEME_DARK = "dark"
        @Volatile private var current: MainActivity? = null

        private fun applySavedTheme(context: Context) {
            AppCompatDelegate.setDefaultNightMode(delegateModeFor(savedTheme(context)))
        }

        private fun savedTheme(context: Context): String =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(PREF_THEME, THEME_AUTO) ?: THEME_AUTO

        private fun delegateModeFor(theme: String): Int = when (theme) {
            THEME_LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
            THEME_DARK -> AppCompatDelegate.MODE_NIGHT_YES
            else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
        }

        private fun MainActivity.prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun requestPhoneAudioFromClient() {
            val activity = current
            if (activity == null) {
                LiveCaptionSender.error(
                    "Open APPS Bridge once so Android can show the Phone Audio permission prompt.",
                    CaptionMode.PHONE_AUDIO,
                )
                return
            }
            activity.runOnUiThread { activity.startPhoneAudioFromClientUi() }
        }

        fun stopPhoneAudioFromClient(reason: String) {
            val activity = current
            if (activity == null) {
                LiveCaptionSender.status(enabled = false, capturing = false, mode = CaptionMode.PHONE_AUDIO, reason = reason)
                return
            }
            activity.runOnUiThread { activity.stopPhoneAudioFromClientUi(reason) }
        }
    }
}
