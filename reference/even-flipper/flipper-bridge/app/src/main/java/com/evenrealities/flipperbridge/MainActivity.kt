package com.evenrealities.flipperbridge

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var deviceText: TextView
    private lateinit var counterText: TextView

    private val uiReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                BridgeService.ACTION_UI_STATUS -> {
                    val frames = intent.getIntExtra(BridgeService.EXTRA_FRAMES, 0)
                    val skips = intent.getIntExtra(BridgeService.EXTRA_SKIPS, 0)
                    counterText.text = "frames: $frames  skips: $skips"
                    // A missing state means this was a counter-only update (a new
                    // frame). Leave the status line alone — frames arrive many
                    // times a second and would otherwise erase the real state.
                    val state = intent.getStringExtra(BridgeService.EXTRA_STATE) ?: return
                    val info = intent.getStringExtra(BridgeService.EXTRA_INFO)
                    val label = STATUS_LABELS[state] ?: state
                    statusText.text = if (info != null) "$label  ($info)" else label
                    // When the link is down, drop the device line so it can't keep
                    // claiming a Flipper that's no longer connected.
                    if (state in LINK_DOWN_STATES) {
                        deviceText.text = getString(R.string.device_unknown)
                    }
                }
                BridgeService.ACTION_UI_DEVICE -> {
                    val name = intent.getStringExtra(BridgeService.EXTRA_DEVICE_NAME) ?: "Flipper"
                    val addr = intent.getStringExtra(BridgeService.EXTRA_DEVICE_ADDR) ?: "?"
                    val rssi = intent.getIntExtra(BridgeService.EXTRA_RSSI, 0)
                    // rssi=0 is the bonded fast-path (no scan, so no advertised
                    // signal sample) — omit it rather than show a misleading 0.
                    deviceText.text = if (rssi != 0) "$name  $addr  rssi=$rssi" else "$name  $addr"
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        deviceText = findViewById(R.id.deviceText)
        counterText = findViewById(R.id.counterText)

        findViewById<Button>(R.id.startBtn).setOnClickListener {
            BridgeService.start(this)
        }
        findViewById<Button>(R.id.stopBtn).setOnClickListener {
            BridgeService.stop(this)
        }
        wireDpad(R.id.btnUp, "up")
        wireDpad(R.id.btnDown, "down")
        wireDpad(R.id.btnLeft, "left")
        wireDpad(R.id.btnRight, "right")
        wireDpad(R.id.btnOk, "ok")
        wireDpad(R.id.btnBack, "back")

        if (hasRequiredPermissions()) {
            // Permissions already granted (returning user) — start immediately.
            BridgeService.start(this)
        } else {
            requestRuntimePermissions()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS && hasRequiredPermissions()) {
            // First-time grant — auto-start the bridge now.
            BridgeService.start(this)
        }
    }

    private fun hasRequiredPermissions(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED
            ) return false
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)
                != PackageManager.PERMISSION_GRANTED
            ) return false
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            ) return false
        }
        return true
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(BridgeService.ACTION_UI_STATUS)
            addAction(BridgeService.ACTION_UI_DEVICE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(uiReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION", "UnspecifiedRegisterReceiverFlag")
            registerReceiver(uiReceiver, filter)
        }
    }

    override fun onStop() {
        super.onStop()
        runCatching { unregisterReceiver(uiReceiver) }
    }

    private fun wireDpad(id: Int, key: String) {
        findViewById<Button>(id).setOnClickListener {
            Log.i(TAG, "local d-pad: $key")
            BridgeService.sendButton(this, key, "short")
        }
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed += Manifest.permission.POST_NOTIFICATIONS
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed += Manifest.permission.BLUETOOTH_CONNECT
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed += Manifest.permission.BLUETOOTH_SCAN
            }
        } else {
            // Pre-Android 12: BLE scan still requires location.
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed += Manifest.permission.ACCESS_FINE_LOCATION
            }
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQ_PERMS)
        }
    }

    companion object {
        private const val TAG = "MainActivity"
        private const val REQ_PERMS = 1001

        // Friendly, accurate labels for the raw states the service broadcasts.
        private val STATUS_LABELS = mapOf(
            "running" to "Bridge running — open the glasses app",
            "idle" to "Waiting for glasses app",
            "scanning" to "Scanning for Flipper…",
            "connecting" to "Connecting to Flipper…",
            "discovering" to "Discovering services…",
            "ready" to "Connected",
            "connected" to "Connected",
            "disconnected" to "Disconnected",
            "stopped" to "Stopped",
        )

        // States where no Flipper is linked — the device line should reset.
        private val LINK_DOWN_STATES = setOf("disconnected", "idle", "stopped")
    }
}
