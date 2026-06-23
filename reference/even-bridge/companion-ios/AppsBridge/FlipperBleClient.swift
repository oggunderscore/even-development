import CoreBluetooth
import Foundation

/// CoreBluetooth GATT central for Flipper Zero.
/// Mirrors the Android FlipperBleClient.kt: same UUIDs, same quirk workarounds.
final class FlipperBleClient: NSObject {

    enum State {
        case idle, scanning, connecting, discovering, ready, disconnected

        var description: String {
            switch self {
            case .idle:         return "idle"
            case .scanning:     return "scanning"
            case .connecting:   return "connecting"
            case .discovering:  return "discovering"
            case .ready:        return "ready"
            case .disconnected: return "disconnected"
            }
        }
    }

    var onStateChange: ((State, String?) -> Void)?
    var onReceive: ((Data) -> Void)?

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var txChar: CBCharacteristic?
    private var rxChar: CBCharacteristic?
    private var mtu: Int = 20

    private var writeQueue: [Data] = []
    private var writeInFlight = false

    // Deferred until BT is powered on.
    private var pendingScan = false

    // All GATT ops happen on this queue; CBCentralManager is tied to it.
    private let bleQueue = DispatchQueue(label: "cc.homeauto.appsbridge.ble", qos: .userInitiated)

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: bleQueue)
    }

    // MARK: - Public API

    func startScanOrConnect() {
        bleQueue.async { [self] in
            guard central.state == .poweredOn else {
                pendingScan = true
                return
            }
            doStartScanOrConnect()
        }
    }

    func disconnect() {
        bleQueue.async { [self] in
            pendingScan = false
            central.stopScan()
            if let p = peripheral { central.cancelPeripheralConnection(p) }
            cleanUp(notify: true)
        }
    }

    /// Thread-safe; chunks to mtu-3 and serialises writes.
    func send(_ data: Data) {
        bleQueue.async { [self] in
            let chunkSize = max(mtu - 3, 20)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunkSize, data.count)
                writeQueue.append(data[offset..<end])
                offset = end
            }
            pumpWrites()
        }
    }

    // MARK: - Private

    private func doStartScanOrConnect() {
        // Fast path: Flipper already in the system's connected-peripheral set.
        let already = central.retrieveConnectedPeripherals(withServices: [Self.serialServiceUUID])
        if let p = already.first(where: { $0.name?.hasPrefix("Flipper ") == true }) {
            onStateChange?(.connecting, p.name)
            doConnect(p)
            return
        }
        onStateChange?(.scanning, nil)
        // No service-UUID filter — Flipper doesn't always advertise its 128-bit UUID.
        central.scanForPeripherals(withServices: nil,
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    private func doConnect(_ p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        central.connect(p, options: nil)
    }

    private func cleanUp(notify: Bool) {
        txChar = nil
        rxChar = nil
        writeQueue.removeAll()
        writeInFlight = false
        // Do NOT set p.delegate = nil here — this is called from within
        // CoreBluetooth delegate callbacks, and mutating the delegate inside
        // a delegate call is undefined behaviour on some iOS versions.
        // CoreBluetooth will release its own reference once we cancel the
        // connection; just drop our reference.
        peripheral = nil
        if notify { onStateChange?(.disconnected, nil) }
    }

    private func pumpWrites() {
        guard !writeQueue.isEmpty, let p = peripheral, let c = txChar else { return }
        if c.properties.contains(.writeWithoutResponse) {
            // Drain as many chunks as the peripheral can accept.
            while !writeQueue.isEmpty && p.canSendWriteWithoutResponse {
                let chunk = writeQueue.removeFirst()
                p.writeValue(chunk, for: c, type: .withoutResponse)
            }
        } else {
            // With-response: single-flight.
            guard !writeInFlight else { return }
            writeInFlight = true
            p.writeValue(writeQueue.removeFirst(), for: c, type: .withResponse)
        }
    }

    // MARK: - GATT UUIDs
    // Source: flipperzero-firmware targets/f7/ble_glue/services/serial_service_uuid.inc
    // Bytes in that file are little-endian (STM Cube convention); reversed here for standard BE strings.

    static let serialServiceUUID = CBUUID(string: "8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000")
    static let txCharUUID        = CBUUID(string: "19ed82ae-ed21-4c9d-4145-228e61fe0000")
    static let rxCharUUID        = CBUUID(string: "19ed82ae-ed21-4c9d-4145-228e62fe0000")
}

// MARK: - CBCentralManagerDelegate

extension FlipperBleClient: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn && pendingScan {
            pendingScan = false
            doStartScanOrConnect()
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        guard peripheral.name?.hasPrefix("Flipper ") == true else { return }
        central.stopScan()
        onStateChange?(.connecting, peripheral.name)
        doConnect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        onStateChange?(.discovering, peripheral.name)
        // 600 ms delay mirrors the Android workaround for Samsung/Qualcomm stacks where
        // discoverServices() inside onConnectionStateChange silently hangs.
        bleQueue.asyncAfter(deadline: .now() + 0.6) { [weak peripheral] in
            peripheral?.discoverServices([FlipperBleClient.serialServiceUUID])
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral, error: Error?) {
        cleanUp(notify: false)
        onStateChange?(.disconnected, error?.localizedDescription)
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        cleanUp(notify: false)
        onStateChange?(.disconnected, error?.localizedDescription ?? "link dropped")
    }
}

// MARK: - CBPeripheralDelegate

extension FlipperBleClient: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil,
              let svc = peripheral.services?.first(where: { $0.uuid == Self.serialServiceUUID })
        else {
            cleanUp(notify: false)
            onStateChange?(.disconnected, error?.localizedDescription ?? "serial service not found")
            return
        }
        peripheral.discoverCharacteristics(nil, for: svc)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else {
            cleanUp(notify: false)
            onStateChange?(.disconnected, "char discovery failed")
            return
        }
        let chars = service.characteristics ?? []
        // Pick by property bits, not by UUID name — mirrors the Android approach.
        rxChar = chars.first { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
        txChar = chars.first { $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse) }
        guard let rx = rxChar, txChar != nil else {
            cleanUp(notify: false)
            onStateChange?(.disconnected, "tx/rx chars missing")
            return
        }
        // Capture the real ATT MTU before enabling notifications.
        mtu = peripheral.maximumWriteValueLength(for: .withoutResponse)
        peripheral.setNotifyValue(true, for: rx)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if error == nil && characteristic.isNotifying {
            onStateChange?(.ready, peripheral.name)
        } else {
            cleanUp(notify: false)
            onStateChange?(.disconnected, "notify enable failed: \(error?.localizedDescription ?? "unknown")")
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        onReceive?(data)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        writeInFlight = false
        pumpWrites()
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        pumpWrites()
    }
}
