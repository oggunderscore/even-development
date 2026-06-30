package com.evenrealities.flipperbridge

import android.util.Log
import io.ktor.serialization.kotlinx.KotlinxWebsocketSerializationConverter
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.netty.NettyApplicationEngine
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.DefaultWebSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import java.util.Collections

/**
 * Embedded Ktor WebSocket server bound to loopback only.
 *
 * Bound to 127.0.0.1 (not 0.0.0.0) so the bridge is not exposed on the LAN.
 * The webapp reaches it via `adb reverse` or by running on the same device.
 */
class WsServer(
    private val onClientMessage: (ClientMessage) -> Unit,
    private val onFirstClientConnected: (() -> Unit)? = null,
    private val onLastClientDisconnected: (() -> Unit)? = null,
    // Real status used to greet a new client. Defaults to disconnected so a
    // standalone WsServer still behaves; BridgeService supplies the live state.
    private val currentStatus: () -> Pair<String, String?> = { "disconnected" to null }
) {
    private val sessions: MutableSet<DefaultWebSocketSession> =
        Collections.synchronizedSet(mutableSetOf())
    private val writeLock = Mutex()

    private var engine: NettyApplicationEngine? = null

    fun start() {
        if (engine != null) return
        engine = embeddedServer(Netty, host = HOST, port = PORT) {
            install(WebSockets) {
                pingPeriodMillis = 15_000L
                timeoutMillis = 30_000L
                contentConverter = KotlinxWebsocketSerializationConverter(Wire.json)
            }
            routing {
                webSocket("/ws") {
                    sessions += this
                    val count = sessions.size
                    Log.i(TAG, "ws client connected; total=$count")
                    if (count == 1) onFirstClientConnected?.invoke()
                    // Greet new client with the REAL current status so the UI can
                    // render immediately and doesn't flash a false "disconnected
                    // / stub mode" on every (re)connect.
                    val (st, info) = currentStatus()
                    sendText(ServerMessage.Status(state = st, info = info))
                    try {
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                handleText(frame.readText())
                            }
                        }
                    } catch (t: Throwable) {
                        Log.w(TAG, "ws session error", t)
                    } finally {
                        sessions -= this
                        val remaining = sessions.size
                        Log.i(TAG, "ws client disconnected; total=$remaining")
                        if (remaining == 0) onLastClientDisconnected?.invoke()
                    }
                }
            }
        }.also { it.start(wait = false) }
        Log.i(TAG, "WsServer started on ws://$HOST:$PORT/ws")
    }

    fun stop() {
        val e = engine ?: return
        engine = null
        runBlocking {
            for (s in sessions.toList()) {
                runCatching { s.close(CloseReason(CloseReason.Codes.GOING_AWAY, "shutdown")) }
            }
            sessions.clear()
        }
        e.stop(500L, 1000L)
        Log.i(TAG, "WsServer stopped")
    }

    suspend fun broadcastFrame(seq: Int, bytes: ByteArray, w: Int = 128, h: Int = 64) {
        val msg = ServerMessage.Frame(
            w = w,
            h = h,
            bpp = 1,
            seq = seq,
            data = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        )
        broadcast(msg)
    }

    suspend fun broadcastStatus(state: String, info: String? = null) {
        broadcast(ServerMessage.Status(state, info))
    }

    private suspend fun broadcast(message: ServerMessage) {
        val text = Wire.json.encodeToString<ServerMessage>(message)
        // Snapshot first so we don't hold the set monitor across suspend points.
        val snapshot = synchronized(sessions) { sessions.toList() }
        for (s in snapshot) {
            try {
                // Ktor sessions are safe for single-writer; lock per-server keeps ordering
                // across the multiple broadcasters (status + frame source).
                writeLock.withLock { s.send(text) }
            } catch (t: Throwable) {
                Log.w(TAG, "broadcast failed; dropping session", t)
                sessions.remove(s)
            }
        }
    }

    private suspend fun DefaultWebSocketSession.sendText(message: ServerMessage) {
        val text = Wire.json.encodeToString<ServerMessage>(message)
        runCatching { send(text) }
    }

    private fun handleText(text: String) {
        val msg = try {
            Wire.json.decodeFromString<ClientMessage>(text)
        } catch (t: Throwable) {
            Log.w(TAG, "ignoring malformed client message: $text", t)
            return
        }
        onClientMessage(msg)
    }

    companion object {
        private const val TAG = "WsServer"
        const val HOST = "127.0.0.1"
        const val PORT = 9876
    }
}
