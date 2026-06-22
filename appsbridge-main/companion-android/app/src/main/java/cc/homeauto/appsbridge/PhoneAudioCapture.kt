package cc.homeauto.appsbridge

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

@RequiresApi(Build.VERSION_CODES.Q)
class PhoneAudioCapture(
    private val context: Context,
    private val projection: MediaProjection,
) {
    private val running = AtomicBoolean(false)
    private var audioRecord: AudioRecord? = null
    private var thread: Thread? = null

    fun start(): Boolean {
        if (running.get()) return true
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            LiveCaptionSender.error("Audio capture permission required", CaptionMode.PHONE_AUDIO)
            return false
        }

        val sampleRate = 16_000
        val minSize = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minSize <= 0) {
            LiveCaptionSender.error("AudioRecord buffer size is unavailable", CaptionMode.PHONE_AUDIO)
            return false
        }

        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        val record = AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(config)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minSize * 4)
            .build()

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            LiveCaptionSender.error("AudioRecord failed to initialize", CaptionMode.PHONE_AUDIO)
            return false
        }

        audioRecord = record
        running.set(true)
        record.startRecording()
        thread = Thread({ readLoop(record, sampleRate, minSize / 2) }, "phone-audio-capture").also { it.start() }
        LiveCaptionSender.status(enabled = true, capturing = true, mode = CaptionMode.PHONE_AUDIO)
        return true
    }

    fun stop(reason: String = "user_stopped") {
        if (!running.getAndSet(false)) return
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
        LiveCaptionSender.status(enabled = false, capturing = false, mode = CaptionMode.PHONE_AUDIO, reason = reason)
    }

    private fun readLoop(record: AudioRecord, sampleRate: Int, samplesPerRead: Int) {
        val buffer = ShortArray(samplesPerRead.coerceAtLeast(1024))
        while (running.get()) {
            val count = try {
                record.read(buffer, 0, buffer.size)
            } catch (e: Exception) {
                LiveCaptionSender.error("Audio capture failed: ${e.message ?: "unknown error"}", CaptionMode.PHONE_AUDIO)
                break
            }
            if (count > 0) {
                LiveCaptionSender.audioPcm16(buffer.copyOf(count), sampleRate, CaptionMode.PHONE_AUDIO)
            }
        }
    }
}
