package cc.homeauto.appsbridge

// Resolves a nav instruction string → icon type key matching NavIcons.
// Rules are ordered — first match wins. Mirrors MDI Navigation Rules JSON v1.1.0.
object NavResolver {

    private val rules = listOf(
        // SYSTEM — must be first; these strings can appear alongside other nav text
        Regex("rerouting|recalculating|off route|gps signal lost|searching for gps|finding faster route|finding route", RegexOption.IGNORE_CASE) to "system",
        // ARRIVAL
        Regex("you have arrived|destination on left|destination on right|arriving", RegexOption.IGNORE_CASE) to "arrive",
        // SHARP — before plain turn so "sharp left" doesn't match "turn left"
        Regex("sharp left|turn sharply left", RegexOption.IGNORE_CASE) to "sharp_left",
        Regex("sharp right|turn sharply right", RegexOption.IGNORE_CASE) to "sharp_right",
        // UTURN — specific direction first, bare u-turn defaults to left
        Regex("u.?turn left|make a left u.?turn", RegexOption.IGNORE_CASE) to "uturn_left",
        Regex("u.?turn right|make a right u.?turn", RegexOption.IGNORE_CASE) to "uturn_right",
        Regex("u.?turn|make a? u.?turn", RegexOption.IGNORE_CASE) to "uturn_left",
        // TURN
        Regex("turn left|turn left onto|turn left at", RegexOption.IGNORE_CASE) to "left",
        Regex("turn right|turn right onto|turn right at", RegexOption.IGNORE_CASE) to "right",
        // KEEP / SLIGHT (same icon)
        Regex("slight left|bear left|curve left|keep left|stay left|fork.*left", RegexOption.IGNORE_CASE) to "keep_left",
        Regex("slight right|bear right|curve right|keep right|stay right|fork.*right", RegexOption.IGNORE_CASE) to "keep_right",
        // MERGE — specific before general
        Regex("merge left", RegexOption.IGNORE_CASE) to "merge_left",
        Regex("merge|take ramp|enter highway", RegexOption.IGNORE_CASE) to "merge_right",
        // ROUNDABOUT
        Regex("roundabout|exit the roundabout|take \\d+(st|nd|rd|th) exit", RegexOption.IGNORE_CASE) to "roundabout",
        // EXIT
        Regex("take exit|exit onto|use exit lane", RegexOption.IGNORE_CASE) to "exit",
        // STRAIGHT — catch-all including all "head [cardinal]" instructions
        Regex("continue straight|continue for|go straight|stay on|follow|proceed|head", RegexOption.IGNORE_CASE) to "straight",
    )

    fun resolve(instruction: String): String? {
        if (instruction.isBlank()) return null
        return rules.firstOrNull { (regex, _) -> regex.containsMatchIn(instruction) }?.second
    }
}
