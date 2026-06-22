package cc.homeauto.appsbridge

interface SpeechToTextEngine {
    var listener: SpeechToTextListener?
    fun start()
    fun stop()
    fun acceptPcm16(buffer: ShortArray, sampleRate: Int)
}

interface SpeechToTextListener {
    fun onPartial(text: String)
    fun onFinal(text: String)
    fun onError(message: String)
}

/**
 * Placeholder STT engine: proves capture -> STT -> websocket plumbing without
 * shipping cloud STT or storing transcripts. Replace with a local/provider
 * adapter later.
 */
class StubSpeechToTextEngine : SpeechToTextEngine {
    override var listener: SpeechToTextListener? = null
    private var running = false
    private var chunks = 0

    override fun start() {
        running = true
        chunks = 0
    }

    override fun stop() {
        running = false
    }

    override fun acceptPcm16(buffer: ShortArray, sampleRate: Int) {
        if (!running || buffer.isEmpty()) return
        chunks++
        if (chunks % 25 == 0) {
            listener?.onPartial("Audio detected. STT engine is currently stubbed.")
        }
        if (chunks % 125 == 0) {
            listener?.onFinal("Audio capture pipeline is active; real transcription adapter is TODO.")
        }
    }
}
