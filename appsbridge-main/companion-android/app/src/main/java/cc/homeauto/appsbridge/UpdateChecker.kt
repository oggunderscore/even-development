package cc.homeauto.appsbridge

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

object UpdateChecker {

    private const val TAG = "UpdateChecker"

    private const val VERSION_URL =
        "https://gitlab.com/homeauto.cc/appsbridge/-/raw/main/companion-version.json"

    private const val PLAY_INSTALLER = "com.android.vending"

    /** True while a download is already in progress — prevents duplicate downloads. */
    @Volatile
    private var downloading = false

    /**
     * Check for a newer companion APK in the background.
     *
     * - Play Store installs: ignored entirely (Play handles updates).
     * - Sideloaded installs: downloads the APK silently, then prompts
     *   the system package-installer so the user just taps "Install".
     */
    fun check(context: Context) {
        if (isInstalledFromPlay(context)) return          // Play Store handles updates

        val currentCode = try {
            context.packageManager
                .getPackageInfo(context.packageName, 0)
                .longVersionCode.toInt()
        } catch (_: Exception) { return }

        Thread {
            try {
                val conn = URL(VERSION_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 8_000
                conn.readTimeout    = 8_000
                conn.useCaches      = false
                val body = conn.inputStream.bufferedReader().readText()
                conn.disconnect()

                val json       = JSONObject(body)
                val remoteCode = json.getInt("versionCode")
                val remoteName = json.optString("versionName", "")
                val apkUrl     = json.optString("apkUrl", "")

                if (remoteCode > currentCode && apkUrl.isNotEmpty()) {
                    Handler(Looper.getMainLooper()).post {
                        showDownloadDialog(context, remoteName, apkUrl)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Update check failed", e)
            }
        }.start()
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    /**
     * Ask the user whether to download the update. On "Update" we kick off
     * a background download and then launch the system installer.
     */
    private fun showDownloadDialog(context: Context, version: String, apkUrl: String) {
        AlertDialog.Builder(context)
            .setTitle("Update Available")
            .setMessage("APPS Bridge $version is available.\n\nTap Update to download and install.")
            .setPositiveButton("Update") { _, _ -> downloadAndInstall(context, apkUrl) }
            .setNegativeButton("Later", null)
            .show()
    }

    // ── Download + Install ──────────────────────────────────────────────────

    private fun downloadAndInstall(context: Context, apkUrl: String) {
        if (downloading) return
        downloading = true

        Thread {
            try {
                val apkFile = downloadApk(context, apkUrl)
                Handler(Looper.getMainLooper()).post {
                    promptInstall(context, apkFile)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Download failed", e)
                Handler(Looper.getMainLooper()).post {
                    AlertDialog.Builder(context)
                        .setTitle("Download Failed")
                        .setMessage("Could not download the update. Please try again later.")
                        .setPositiveButton("OK", null)
                        .show()
                }
            } finally {
                downloading = false
            }
        }.start()
    }

    /**
     * Downloads the APK to the app's private cache directory.
     * Returns the resulting [File].
     */
    private fun downloadApk(context: Context, apkUrl: String): File {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, "update.apk")

        val conn = URL(apkUrl).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout    = 60_000
        conn.useCaches      = false

        conn.inputStream.use { input ->
            FileOutputStream(file).use { output ->
                input.copyTo(output)
            }
        }
        conn.disconnect()

        return file
    }

    /**
     * Opens the system package-installer for the downloaded APK.
     * Uses FileProvider so the installer can read from our private cache.
     */
    private fun promptInstall(context: Context, apkFile: File) {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        context.startActivity(intent)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun isInstalledFromPlay(context: Context): Boolean {
        val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                context.packageManager
                    .getInstallSourceInfo(context.packageName)
                    .installingPackageName
            } catch (_: PackageManager.NameNotFoundException) { null }
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getInstallerPackageName(context.packageName)
        }
        return installer == PLAY_INSTALLER
    }
}
