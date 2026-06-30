package com.evenrealities.flipperbridge

import com.flipperdevices.protobuf.Flipper
import com.flipperdevices.protobuf.screen.Gui
import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import java.io.ByteArrayOutputStream

/**
 * Length-delimited Flipper RPC framing.
 *
 * Wire format (both directions, after the BLE serial transport is open):
 *   <varint length> <Main protobuf>
 * Ported from linux-bridge/bridge.py.
 */
class FlipperRpc {

    private val rxBuf = ByteArrayOutputStream()
    private var nextId = 1

    /**
     * Clear accumulated parser state. MUST be called before a fresh BLE
     * connection: rxBuf can hold a partial frame from the previous session, and
     * appending the new session's bytes onto that stale tail corrupts varint
     * framing so no Main message ever decodes again - the screen silently never
     * streams after a reconnect.
     */
    @Synchronized
    fun reset() {
        rxBuf.reset()
        nextId = 1
    }

    fun startScreenStream(): ByteArray {
        val id = nextId++
        val main = Flipper.Main.newBuilder()
            .setCommandId(id)
            .setHasNext(false)
            .setGuiStartScreenStreamRequest(Gui.StartScreenStreamRequest.getDefaultInstance())
            .build()
        return frame(main)
    }

    fun stopScreenStream(): ByteArray {
        val id = nextId++
        val main = Flipper.Main.newBuilder()
            .setCommandId(id)
            .setHasNext(false)
            .setGuiStopScreenStreamRequest(Gui.StopScreenStreamRequest.getDefaultInstance())
            .build()
        return frame(main)
    }

    /**
     * Build the bytes for an input event. action="short" expands to the
     * PRESS -> SHORT -> RELEASE triplet because Flipper firmware 0.103.x
     * silently drops a lone SHORT (see bridge.py for the canonical sequence).
     */
    fun sendInputEvent(key: String, action: String): ByteArray? {
        val frames = sendInputEventChunks(key, action) ?: return null
        val out = ByteArrayOutputStream()
        for (f in frames) out.write(f)
        return out.toByteArray()
    }

    /**
     * Build each Main as its own frame so the caller can pace them with small
     * delays. Sending PRESS/SHORT/RELEASE in a single BLE burst sometimes
     * causes the Flipper to coalesce them into a no-op after the link has
     * been idle for ~1s (radio wake-up timing).
     */
    fun sendInputEventChunks(key: String, action: String): List<ByteArray>? {
        val k = KEY_MAP[key.lowercase()] ?: return null
        // PRESS -> SHORT -> RELEASE. The temporally correct order per firmware
        // docs is PRESS -> RELEASE -> SHORT, but empirically Flipper apps
        // (and the working Python bridge.py reference) react to this order
        // and don't react to the doc order. Keep this until proven otherwise.
        val seq: List<Gui.InputType> = when (action.lowercase()) {
            "short" -> listOf(Gui.InputType.PRESS, Gui.InputType.SHORT, Gui.InputType.RELEASE)
            "long" -> listOf(Gui.InputType.PRESS, Gui.InputType.LONG, Gui.InputType.RELEASE)
            else -> {
                val t = TYPE_MAP[action.lowercase()] ?: return null
                listOf(t)
            }
        }
        return seq.map { t ->
            val id = nextId++
            val main = Flipper.Main.newBuilder()
                .setCommandId(id)
                .setHasNext(false)
                .setGuiSendInputEventRequest(
                    Gui.SendInputEventRequest.newBuilder()
                        .setKey(k)
                        .setType(t)
                        .build()
                )
                .build()
            frame(main)
        }
    }

    /**
     * Accumulate inbound bytes; return all complete Main messages that can be
     * decoded from the buffer so far. Partial trailing frames stay buffered.
     */
    @Synchronized
    fun parseIncoming(chunk: ByteArray): List<Flipper.Main> {
        if (chunk.isNotEmpty()) rxBuf.write(chunk)
        val out = mutableListOf<Flipper.Main>()
        while (true) {
            val buf = rxBuf.toByteArray()
            if (buf.isEmpty()) break
            val cis = CodedInputStream.newInstance(buf)
            val sizeStart: Int
            val size: Int
            try {
                size = cis.readRawVarint32()
                sizeStart = cis.totalBytesRead
            } catch (_: Throwable) {
                // Incomplete varint; wait for more bytes.
                break
            }
            if (buf.size - sizeStart < size) break // body not fully arrived
            val msgBytes = buf.copyOfRange(sizeStart, sizeStart + size)
            val consumed = sizeStart + size
            // Reset buffer to remaining tail.
            rxBuf.reset()
            if (consumed < buf.size) rxBuf.write(buf, consumed, buf.size - consumed)
            try {
                out += Flipper.Main.parseFrom(msgBytes)
            } catch (_: Throwable) {
                // Drop one malformed frame; keep going on whatever follows.
            }
        }
        return out
    }

    private fun frame(main: Flipper.Main): ByteArray {
        val body = main.toByteArray()
        val out = ByteArrayOutputStream(body.size + 5)
        val cos = CodedOutputStream.newInstance(out)
        cos.writeUInt32NoTag(body.size)
        cos.flush()
        out.write(body)
        return out.toByteArray()
    }

    companion object {
        const val SCR_W = 128
        const val SCR_H = 64
        const val ROW_BYTES = SCR_W / 8
        const val EXPECTED_FRAME_BYTES = SCR_W * SCR_H / 8

        private val KEY_MAP = mapOf(
            "up" to Gui.InputKey.UP,
            "down" to Gui.InputKey.DOWN,
            "left" to Gui.InputKey.LEFT,
            "right" to Gui.InputKey.RIGHT,
            "ok" to Gui.InputKey.OK,
            "back" to Gui.InputKey.BACK,
        )

        private val TYPE_MAP = mapOf(
            "press" to Gui.InputType.PRESS,
            "release" to Gui.InputType.RELEASE,
            "short" to Gui.InputType.SHORT,
            "long" to Gui.InputType.LONG,
            "repeat" to Gui.InputType.REPEAT,
        )

        /**
         * SSD1306 page format -> row-major MSB-first, 1bpp.
         * Direct port of flipper_to_rowmajor() from bridge.py.
         */
        fun flipperToRowMajor(buf: ByteArray): ByteArray {
            require(buf.size == EXPECTED_FRAME_BYTES) {
                "expected $EXPECTED_FRAME_BYTES bytes, got ${buf.size}"
            }
            val out = ByteArray(EXPECTED_FRAME_BYTES)
            val pages = SCR_H / 8
            for (page in 0 until pages) {
                for (col in 0 until SCR_W) {
                    val v = buf[page * SCR_W + col].toInt() and 0xFF
                    for (bit in 0 until 8) {
                        if (v and (1 shl bit) != 0) {
                            val y = page * 8 + bit
                            val idx = y * ROW_BYTES + (col ushr 3)
                            val mask = 1 shl (7 - (col and 7))
                            out[idx] = (out[idx].toInt() or mask).toByte()
                        }
                    }
                }
            }
            return out
        }
    }
}
