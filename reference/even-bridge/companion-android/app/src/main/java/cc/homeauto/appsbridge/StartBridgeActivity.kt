package cc.homeauto.appsbridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.core.content.ContextCompat

/**
 * Transparent trampoline activity — starts BridgeService and immediately finishes.
 * Launched via the intent:// URL scheme from the Moto HUD WebView on boot so the
 * bridge starts without bringing any UI to the foreground.
 *
 * Intent URL used by HUD:
 *   intent://#Intent;action=cc.homeauto.appsbridge.START_BRIDGE;package=cc.homeauto.appsbridge;end
 */
class StartBridgeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!SharedState.serverRunning) {
            val intent = Intent(this, BridgeService::class.java).apply {
                action = BridgeService.ACTION_REQUIRE_FOREGROUND
            }
            ContextCompat.startForegroundService(this, intent)
        }
        finish()
    }
}
