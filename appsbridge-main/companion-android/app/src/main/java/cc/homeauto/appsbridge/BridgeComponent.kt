package cc.homeauto.appsbridge

enum class BridgeComponent(val wireValue: String) {
    GPS("gps"),
    MEDIA("media"),
    NAV("nav"),
    HTTP("http"),
    CAPTIONS("captions"),
    PHONE_AUDIO("phone_audio");

    companion object {
        fun fromWireValue(value: String): BridgeComponent? {
            val normalized = value.trim().lowercase().replace("-", "_")
            return values().firstOrNull { it.wireValue == normalized }
        }

        fun wireValues(components: Set<BridgeComponent>): String =
            components.sortedBy { it.wireValue }.joinToString(",") { it.wireValue }
    }
}

data class ClientRequest(
    val app: String,
    val name: String,
    val components: Set<BridgeComponent>,
    val managedLifecycle: Boolean = false,
    val updatedAtMs: Long = System.currentTimeMillis(),
)
