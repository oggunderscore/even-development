package com.evenrealities.flipperbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Starts the bridge service automatically on device boot so it's already
 * BLE-connected to the Flipper by the time the Even Realities app opens.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.i(TAG, "Boot completed — starting BridgeService")
            BridgeService.start(context)
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
