package com.evenrealities.flipperbridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.ExperimentalSerializationApi

/**
 * Wire protocol for ws://127.0.0.1:9876/ws.
 *
 * The webapp agent implements the mirror of these types in TypeScript. Keep
 * field names, casing, and the "type" discriminator stable.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("type")
sealed class ServerMessage {

    @Serializable
    @SerialName("status")
    data class Status(
        val state: String, // "scanning" | "connected" | "disconnected"
        val info: String? = null
    ) : ServerMessage()

    @Serializable
    @SerialName("frame")
    data class Frame(
        val w: Int = 128,
        val h: Int = 64,
        val bpp: Int = 1,
        val seq: Int,
        // Base64 of (w*h/8) bytes, row-major, MSB-first within each byte.
        val data: String
    ) : ServerMessage()
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("type")
sealed class ClientMessage {

    @Serializable
    @SerialName("connect")
    data object Connect : ClientMessage()

    @Serializable
    @SerialName("disconnect")
    data object Disconnect : ClientMessage()

    @Serializable
    @SerialName("button")
    data class Button(
        val key: String, // "up" | "down" | "left" | "right" | "ok" | "back"
        val action: String // "short" | "long" | "press" | "release"
    ) : ClientMessage()

    // Flow-control credit: the webapp finished rendering the previous frame and
    // wants the next one (see BridgeService closed-loop pacing). Without this
    // variant the `{"type":"ready"}` credit fails polymorphic deserialization
    // and is dropped as "malformed", so the bridge only ever ships frames via
    // the ACK_TIMEOUT fallback.
    @Serializable
    @SerialName("ready")
    data object Ready : ClientMessage()
}

object Wire {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        classDiscriminator = "type"
    }
}
