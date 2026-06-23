package cc.homeauto.appsbridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

class PhoneAudioCaptureService : Service() {
    private var capture: PhoneAudioCapture? = null
    private var projection: MediaProjection? = null
    private var stopping = false

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startFromIntent(intent)
            ACTION_STOP -> stopCapture(intent.getStringExtra(EXTRA_REASON) ?: "user_stopped")
            else -> stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopCapture("service_destroyed")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startFromIntent(intent: Intent) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (resultData == null) {
            LiveCaptionSender.error("Audio capture permission required", CaptionMode.PHONE_AUDIO)
            stopSelf()
            return
        }

        try {
            stopping = false
            startAsForeground()
            val mgr = getSystemService(MediaProjectionManager::class.java)
            val mediaProjection = mgr.getMediaProjection(resultCode, resultData)
            projection = mediaProjection
            mediaProjection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stopCapture("projection_stopped")
                }
            }, Handler(Looper.getMainLooper()))

            capture?.stop("restarting")
            capture = PhoneAudioCapture(this, mediaProjection).also {
                if (!it.start()) stopSelf()
            }
        } catch (e: Exception) {
            LiveCaptionSender.error(
                "Phone Audio capture failed: ${e.message ?: e.javaClass.simpleName}",
                CaptionMode.PHONE_AUDIO,
            )
            stopSelf()
        }
    }

    private fun stopCapture(reason: String) {
        if (stopping) return
        stopping = true
        capture?.stop(reason)
        capture = null
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CC Live Phone Audio")
            .setContentText("Capturing supported Android playback audio")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun ensureChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "CC Live Phone Audio", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Android playback-audio capture for CC Live"
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    companion object {
        private const val ACTION_START = "cc.homeauto.appsbridge.PHONE_AUDIO_START"
        private const val ACTION_STOP = "cc.homeauto.appsbridge.PHONE_AUDIO_STOP"
        private const val EXTRA_RESULT_CODE = "result_code"
        private const val EXTRA_RESULT_DATA = "result_data"
        private const val EXTRA_REASON = "reason"
        private const val CHANNEL_ID = "cc_live_phone_audio"
        private const val NOTIF_ID = 2

        fun start(context: Context, resultCode: Int, resultData: Intent) {
            val intent = Intent(context, PhoneAudioCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, resultData)
            }
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context, reason: String) {
            val intent = Intent(context, PhoneAudioCaptureService::class.java).apply {
                action = ACTION_STOP
                putExtra(EXTRA_REASON, reason)
            }
            context.startService(intent)
        }
    }
}
