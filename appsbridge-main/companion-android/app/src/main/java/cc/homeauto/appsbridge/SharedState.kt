package cc.homeauto.appsbridge

/** Single source of truth shared between services and UI. All fields are @Volatile. */
object SharedState {
    // GPS
    @Volatile var gpsSpeed:    Float   = 0f
    @Volatile var gpsHeading:  Float?  = null
    @Volatile var gpsLat:      Double? = null
    @Volatile var gpsLng:      Double? = null
    @Volatile var gpsAccuracy: Float?  = null
    @Volatile var gpsLastError: String = ""
    @Volatile var gpsLastUpdateMs: Long = 0L

    // Media
    @Volatile var mediaTitle:  String = ""
    @Volatile var mediaArtist: String = ""
    @Volatile var mediaStatus: String = "unknown"  // playing | paused | unknown

    // Navigation (populated from NotificationListenerService)
    @Volatile var navInstruction: String = ""
    @Volatile var navDistance:    String = ""
    @Volatile var navEta:         String = ""
    @Volatile var navIcon:        String = ""   // base64 PNG from notification, "" if unavailable
    @Volatile var navIconType:    String = ""   // resolved MDI type key, "" if unresolved
    @Volatile var navRouteActive: Boolean = false

    // Raw extras dump for /debug/nav
    @Volatile var navDebugTitle:   String = ""
    @Volatile var navDebugText:    String = ""
    @Volatile var navDebugBig:     String = ""
    @Volatile var navDebugSub:     String = ""
    @Volatile var navDebugPkg:     String = ""

    // Service
    @Volatile var serverRunning: Boolean = false
    @Volatile var gpsActive:     Boolean = false   // true only after Android accepts GPS updates
    @Volatile var httpActive:    Boolean = false
    @Volatile var mediaActive:   Boolean = false
    @Volatile var navActive:     Boolean = false
    @Volatile var captionsActive: Boolean = false
    @Volatile var phoneAudioRequested: Boolean = false
    @Volatile var requestedComponents: String = ""
    @Volatile var wsActiveModule: String = ""
    @Volatile var wsActiveModuleLabel: String = ""

    // CC Live
    @Volatile var ccEnabled: Boolean = false
    @Volatile var ccCapturing: Boolean = false
    @Volatile var ccMode: String = "glasses_mic" // phone_audio | glasses_mic | test
    @Volatile var ccSource: String = "glasses_microphone"
    @Volatile var ccEngine: String = "stub"
    @Volatile var ccLastError: String = ""
}
