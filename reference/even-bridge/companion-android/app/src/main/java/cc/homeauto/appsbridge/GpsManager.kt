package cc.homeauto.appsbridge

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager

class GpsManager(private val context: Context) : LocationListener {

    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        try {
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                SharedState.gpsLastError = "GPS provider disabled"
                android.util.Log.w("AppsBridge/GPS", SharedState.gpsLastError)
                return false
            }
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0.5f, this)
            SharedState.gpsLastError = ""
            android.util.Log.i("AppsBridge/GPS", "GPS listener started")
            return true
        } catch (e: SecurityException) {
            SharedState.gpsLastError = "Location permission denied"
            android.util.Log.w("AppsBridge/GPS", "GPS listener rejected: " + e.message, e)
        } catch (e: Exception) {
            SharedState.gpsLastError = e.message ?: e.javaClass.simpleName
            android.util.Log.w("AppsBridge/GPS", "GPS listener failed: " + e.message, e)
        }
        return false
    }

    fun stop() {
        try { lm.removeUpdates(this) } catch (_: Exception) {}
        android.util.Log.i("AppsBridge/GPS", "GPS listener stopped")
    }

    override fun onLocationChanged(loc: Location) {
        SharedState.gpsLastUpdateMs = System.currentTimeMillis()
        SharedState.gpsSpeed    = loc.speed
        SharedState.gpsHeading  = if (loc.hasBearing())  loc.bearing  else null
        SharedState.gpsLat      = loc.latitude
        SharedState.gpsLng      = loc.longitude
        SharedState.gpsAccuracy = if (loc.hasAccuracy()) loc.accuracy else null
        BridgeServer.instance?.broadcastGps()
        WsServer.instance?.broadcastGps()
    }
}
