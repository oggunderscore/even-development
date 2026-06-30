package com.evenrealities.flipperbridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Emits a fake 128x64 1bpp frame at 2 fps: a 4-px-wide vertical bar that
 * sweeps left-to-right and wraps. Useful for end-to-end pipeline testing
 * before the real BLE client lands.
 *
 * Frame byte layout matches the wire contract: row-major, 8 horizontal pixels
 * per byte, MSB = leftmost pixel.
 */
class StubFrameSource(
    private val onFrame: suspend (seq: Int, bytes: ByteArray) -> Unit
) {
    private var job: Job? = null
    private var seq = 0

    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        seq = 0
        job = scope.launch(Dispatchers.Default) {
            var x = 0
            while (isActive) {
                val bytes = renderBar(x)
                onFrame(seq++, bytes)
                x = (x + 4) % WIDTH
                delay(PERIOD_MS)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private fun renderBar(xStart: Int): ByteArray {
        val out = ByteArray(WIDTH * HEIGHT / 8)
        val barWidth = 4
        for (y in 0 until HEIGHT) {
            val rowOffset = y * (WIDTH / 8)
            for (i in 0 until barWidth) {
                val x = (xStart + i) % WIDTH
                val byteIdx = rowOffset + (x ushr 3)
                val bit = 0x80 ushr (x and 0x07)
                out[byteIdx] = (out[byteIdx].toInt() or bit).toByte()
            }
        }
        return out
    }

    companion object {
        const val WIDTH = 128
        const val HEIGHT = 64
        private const val PERIOD_MS = 500L
    }
}
