package com.evenrealities.flipperbridge

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.ParcelUuid
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Real Flipper Zero BLE GATT client.
 *
 * GATT UUIDs are taken from the firmware source of truth:
 *   targets/f7/ble_glue/services/serial_service_uuid.inc
 *   https://github.com/flipperdevices/flipperzero-firmware/blob/dev/targets/f7/ble_glue/services/serial_service_uuid.inc
 * The bytes in the .inc are little-endian (Cube-stack convention); they are
 * reversed below to produce standard big-endian UUID strings.
 *
 * If Flipper firmware ever rotates these, regenerate from the same file.
 */
class FlipperBleClient(
    private val context: Context,
    private val handler: Handler = Handler(Looper.getMainLooper())
) {

    interface Listener {
        fun onScanResult(device: BluetoothDevice, rssi: Int)
        fun onStateChange(state: State, info: String? = null)
    }

    enum class State { IDLE, SCANNING, CONNECTING, DISCOVERING, READY, DISCONNECTED }

    @Volatile var listener: Listener? = null
    @Volatile var onReceive: ((ByteArray) -> Unit)? = null

    @Volatile var connectedDevice: BluetoothDevice? = null
        private set
    @Volatile var lastRssi: Int = 0
        private set

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private var gatt: BluetoothGatt? = null
    private var txChar: BluetoothGattCharacteristic? = null
    private var rxChar: BluetoothGattCharacteristic? = null

    @SuppressLint("MissingPermission")
    private fun enableRxNotifications(g: BluetoothGatt) {
        val rx = rxChar
        if (rx == null) {
            Log.w(TAG, "enableRxNotifications: rxChar null")
            return
        }
        if (!hasConnectPerm()) {
            listener?.onStateChange(State.DISCONNECTED, "missing BLUETOOTH_CONNECT")
            return
        }
        Log.i(TAG, "enableRxNotifications: rx props=0x${"%02x".format(rx.properties)}")
        val notifyOk = g.setCharacteristicNotification(rx, true)
        Log.i(TAG, "setCharacteristicNotification: $notifyOk")
        val ccc = rx.getDescriptor(CCC_DESCRIPTOR_UUID)
        if (ccc == null) {
            Log.w(TAG, "CCC descriptor missing on rx char")
            return
        }
        // Use NOTIFY or INDICATE depending on what the char supports.
        val useIndicate = (rx.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0 &&
            (rx.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
        val value = if (useIndicate)
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        else
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        Log.i(TAG, "writing CCC: indicate=$useIndicate")
        val rc: Any? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeDescriptor(ccc, value)
        } else {
            @Suppress("DEPRECATION")
            ccc.value = value
            @Suppress("DEPRECATION")
            g.writeDescriptor(ccc)
        }
        Log.i(TAG, "writeDescriptor returned: $rc")
    }

    private fun refreshGattCache(g: BluetoothGatt) {
        try {
            val method = g.javaClass.getMethod("refresh")
            val ok = method.invoke(g) as? Boolean
            Log.i(TAG, "refresh returned: $ok")
        } catch (e: Exception) {
            Log.w(TAG, "refresh failed: $e")
        }
    }

    // Single-flight write queue; BluetoothGatt enforces one outstanding write
    // at a time. We chunk to (mtu - 3) and serialise on the GATT callback.
    private val writeQueue = ConcurrentLinkedQueue<ByteArray>()
    private val writeInFlight = AtomicBoolean(false)
    @Volatile private var mtu: Int = 23

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val dev = result.device
            val name = safeName(dev) ?: return
            // Trailing space is intentional - Flipper advertises "Flipper <NAME>".
            if (!name.startsWith("Flipper ")) return
            listener?.onScanResult(dev, result.rssi)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.w(TAG, "scan failed: $errorCode")
            listener?.onStateChange(State.DISCONNECTED, "scan failed: $errorCode")
        }
    }

    private val scanRunning = AtomicBoolean(false)

    @SuppressLint("MissingPermission")
    fun startScan(): Boolean {
        val a = adapter ?: return false
        if (!a.isEnabled) {
            listener?.onStateChange(State.DISCONNECTED, "bluetooth disabled")
            return false
        }
        if (!hasScanPerm()) {
            listener?.onStateChange(State.DISCONNECTED, "missing BLUETOOTH_SCAN")
            return false
        }
        if (!scanRunning.compareAndSet(false, true)) {
            Log.i(TAG, "startScan: already running, ignoring")
            return true
        }
        // Fast path: if a Flipper is already bonded, connect directly without
        // scanning. Avoids Android's silent "too frequent scans" throttle
        // entirely (5 scans / 30s -> ~30 min silent dropout).
        val bondedFlipper = a.bondedDevices?.firstOrNull {
            hasConnectPerm() && (it.name?.startsWith("Flipper ") == true)
        }
        if (bondedFlipper != null) {
            Log.i(TAG, "skipping scan: connecting to bonded ${bondedFlipper.name}")
            scanRunning.set(false)
            connect(bondedFlipper)
            return true
        }
        val scanner = a.bluetoothLeScanner ?: run {
            scanRunning.set(false)
            return false
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        // No filter: Flipper doesn't always advertise the full 128-bit serial
        // service UUID in its ad packet; filtering would silently miss it.
        // We match in the scan callback by name prefix.
        scanner.startScan(null, settings, scanCb)
        listener?.onStateChange(State.SCANNING)
        return true
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        val a = adapter ?: return
        if (!hasScanPerm()) return
        runCatching { a.bluetoothLeScanner?.stopScan(scanCb) }
        scanRunning.set(false)
    }

    @SuppressLint("MissingPermission")
    fun connect(device: BluetoothDevice) {
        if (!hasConnectPerm()) {
            listener?.onStateChange(State.DISCONNECTED, "missing BLUETOOTH_CONNECT")
            return
        }
        stopScan()
        disconnectInternal()
        connectedDevice = device
        listener?.onStateChange(State.CONNECTING, safeName(device))
        gatt = device.connectGatt(context, false, gattCb, BluetoothDevice.TRANSPORT_LE)
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        disconnectInternal()
        listener?.onStateChange(State.DISCONNECTED)
    }

    @SuppressLint("MissingPermission")
    private fun disconnectInternal() {
        val g = gatt ?: return
        gatt = null
        txChar = null
        rxChar = null
        writeQueue.clear()
        writeInFlight.set(false)
        runCatching { g.disconnect() }
        runCatching { g.close() }
    }

    /**
     * Enqueue bytes to write to the TX characteristic. Chunked at (mtu - 3) to
     * fit the ATT MTU. Safe to call from any thread.
     */
    fun send(bytes: ByteArray) {
        Log.i(TAG, "send: ${bytes.size}B, mtu=$mtu, txChar=${txChar?.uuid}")
        val chunkSize = (mtu - 3).coerceAtLeast(20)
        var i = 0
        while (i < bytes.size) {
            val end = minOf(i + chunkSize, bytes.size)
            writeQueue.add(bytes.copyOfRange(i, end))
            i = end
        }
        pumpWrites()
    }

    @SuppressLint("MissingPermission")
    private fun pumpWrites() {
        val g = gatt ?: return
        val c = txChar ?: return
        if (!hasConnectPerm()) return
        if (!writeInFlight.compareAndSet(false, true)) return
        val next = writeQueue.poll()
        if (next == null) {
            writeInFlight.set(false)
            return
        }
        // Serial RPC over BLE conventionally uses WRITE_NO_RESPONSE for
        // throughput. The Flipper TX char advertises both modes.
        val wtype = if ((c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        else
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val rc = g.writeCharacteristic(c, next, wtype)
            Log.i(TAG, "writeCharacteristic ${next.size}B wtype=$wtype rc=$rc")
            if (rc != BluetoothGatt.GATT_SUCCESS) {
                writeInFlight.set(false)
                handler.post { pumpWrites() }
            }
        } else {
            @Suppress("DEPRECATION")
            c.value = next
            @Suppress("DEPRECATION")
            c.writeType = wtype
            @Suppress("DEPRECATION")
            val ok = g.writeCharacteristic(c)
            Log.i(TAG, "writeCharacteristic ${next.size}B wtype=$wtype ok=$ok")
            if (!ok) {
                writeInFlight.set(false)
                handler.post { pumpWrites() }
            }
        }
    }

    private val gattCb = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            Log.i(TAG, "onConnectionStateChange status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                listener?.onStateChange(State.DISCOVERING)
                // Ask Android for a fast connection interval. Default is
                // ~50ms+; HIGH is ~7.5-15ms. Without this, the first packet
                // after a brief idle period (e.g. switching d-pad keys) gets
                // dropped by Flipper's input handler.
                runCatching {
                    g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                }
                // Order matters on Samsung/Qualcomm stacks: do discoverServices
                // FIRST, then MTU negotiation in onServicesDiscovered. MTU before
                // discovery often silently hangs even with a delay. Also refresh
                // the GATT cache via reflection so we don't get a stale empty
                // service list from a prior session.
                Handler(Looper.getMainLooper()).postDelayed({
                    if (!hasConnectPerm()) return@postDelayed
                    refreshGattCache(g)
                    val ok = g.discoverServices()
                    Log.i(TAG, "discoverServices started: $ok")
                }, 600)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                disconnectInternal()
                listener?.onStateChange(State.DISCONNECTED, "status=$status")
            }
        }

        @SuppressLint("MissingPermission")
        override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) {
            mtu = newMtu
            Log.i(TAG, "MTU=$newMtu status=$status")
            // After MTU we can enable notifications on RX.
            enableRxNotifications(g)
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            Log.i(TAG, "onServicesDiscovered status=$status, ${g.services.size} services")
            for (s in g.services) Log.d(TAG, "  service ${s.uuid}")
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener?.onStateChange(State.DISCONNECTED, "discover failed: $status")
                return
            }
            val svc = g.getService(SERIAL_SERVICE_UUID)
            if (svc == null) {
                listener?.onStateChange(State.DISCONNECTED, "serial service not found")
                return
            }
            // Dump every char + props so we can pick the right one regardless
            // of which UUID is "RX" vs "TX" in firmware naming.
            for (c in svc.characteristics) {
                Log.i(TAG, "  char ${c.uuid} props=0x${"%02x".format(c.properties)}")
            }
            // The notifying char is the one we read FROM the Flipper.
            val notifyProps = BluetoothGattCharacteristic.PROPERTY_NOTIFY or
                BluetoothGattCharacteristic.PROPERTY_INDICATE
            val writeProps = BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
            rxChar = svc.characteristics.firstOrNull { (it.properties and notifyProps) != 0 }
            txChar = svc.characteristics.firstOrNull { (it.properties and writeProps) != 0 }
            if (txChar == null || rxChar == null) {
                listener?.onStateChange(State.DISCONNECTED, "tx/rx char missing")
                return
            }
            Log.i(TAG, "selected rx=${rxChar?.uuid} tx=${txChar?.uuid}")
            // Negotiate MTU now; notifications get enabled in onMtuChanged.
            if (hasConnectPerm()) g.requestMtu(MAX_MTU)
        }

        override fun onDescriptorWrite(
            g: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            Log.i(TAG, "onDescriptorWrite ${descriptor.uuid} status=$status")
            if (descriptor.uuid == CCC_DESCRIPTOR_UUID) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    listener?.onStateChange(State.READY)
                } else {
                    listener?.onStateChange(State.DISCONNECTED, "ccc write failed: $status")
                }
            }
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            writeInFlight.set(false)
            pumpWrites()
        }

        // API <= 32
        @Deprecated("Deprecated in API 33")
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == rxChar?.uuid) {
                @Suppress("DEPRECATION")
                val v = characteristic.value ?: return
                Log.i(TAG, "rx (legacy) ${v.size}B")
                onReceive?.invoke(v)
            }
        }

        // API 33+
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            if (characteristic.uuid == rxChar?.uuid) {
                Log.i(TAG, "rx ${value.size}B")
                onReceive?.invoke(value)
            } else {
                Log.d(TAG, "rx (other char) ${characteristic.uuid} ${value.size}B")
            }
        }

        @SuppressLint("MissingPermission")
        override fun onReadRemoteRssi(g: BluetoothGatt, rssi: Int, status: Int) {
            lastRssi = rssi
        }
    }

    @SuppressLint("MissingPermission")
    fun pollRssi() {
        if (!hasConnectPerm()) return
        gatt?.readRemoteRssi()
    }

    private fun safeName(device: BluetoothDevice): String? {
        if (!hasConnectPerm()) return null
        return try { device.name } catch (_: SecurityException) { null }
    }

    private fun hasScanPerm(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun hasConnectPerm(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
    }

    companion object {
        private const val TAG = "FlipperBleClient"
        const val MAX_MTU = 512

        // Standard CCC descriptor (BLE spec) - enables notifications.
        val CCC_DESCRIPTOR_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Sourced from flipperzero-firmware:
        // targets/f7/ble_glue/services/serial_service_uuid.inc
        // (bytes there are little-endian; these strings are the standard
        // big-endian UUID form).
        val SERIAL_SERVICE_UUID: UUID = UUID.fromString("8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000")
        val TX_CHAR_UUID: UUID = UUID.fromString("19ed82ae-ed21-4c9d-4145-228e61fe0000")
        val RX_CHAR_UUID: UUID = UUID.fromString("19ed82ae-ed21-4c9d-4145-228e62fe0000")
        val FLOW_CONTROL_UUID: UUID = UUID.fromString("19ed82ae-ed21-4c9d-4145-228e63fe0000")
        val RPC_STATUS_UUID: UUID = UUID.fromString("19ed82ae-ed21-4c9d-4145-228e64fe0000")
    }
}
