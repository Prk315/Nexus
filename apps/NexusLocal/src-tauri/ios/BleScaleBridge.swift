#if os(iOS)
import CoreBluetooth
import Foundation

/// Protocol-agnostic BLE recon scanner. Fingerprints nearby devices (name, RSSI,
/// advertised service UUIDs, manufacturer data) and — when given a name filter —
/// connects to the first match, enumerates its GATT services/characteristics,
/// subscribes to every notifiable characteristic, and captures the raw frames
/// (hex) it emits. Everything is written as JSON to tmp/ble_scan.json for the
/// Rust/JS layer to read. This is how we identify the Vellafit scale's protocol.
///
/// NOTE: CoreBluetooth does nothing in the iOS Simulator — physical device only.
final class BleScaleScanner: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = BleScaleScanner()

    private var central: CBCentralManager?
    private var devices: [UUID: [String: Any]] = [:]
    private var frames: [[String: Any]] = []
    private var connectFilter: String = ""
    private var target: CBPeripheral?          // strong ref while connected
    private var connectedInfo: [String: Any] = [:]
    private var wantScan = false
    private var stopAt: Date?

    // MARK: - Control

    func start(seconds: Double, connectFilter: String) {
        self.connectFilter = connectFilter.lowercased()
        self.devices.removeAll()
        self.frames.removeAll()
        self.connectedInfo.removeAll()
        self.target = nil
        self.wantScan = true
        self.stopAt = Date().addingTimeInterval(seconds)

        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main)
        } else if central?.state == .poweredOn {
            beginScan()
        }
        writeSnapshot(status: "starting")

        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.stop()
        }
    }

    func stop() {
        wantScan = false
        central?.stopScan()
        if let t = target { central?.cancelPeripheralConnection(t) }
        writeSnapshot(status: "done")
    }

    private func beginScan() {
        // allowDuplicates so RSSI/manufacturer data refresh as the user moves.
        central?.scanForPeripherals(withServices: nil,
                                    options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        writeSnapshot(status: "scanning")
    }

    // MARK: - CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn, wantScan {
            beginScan()
        } else {
            writeSnapshot(status: "bt-state-\(central.state.rawValue)")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? peripheral.name ?? ""
        let serviceUUIDs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?
            .map { $0.uuidString } ?? []
        let mfg = (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data)?.hex ?? ""

        devices[peripheral.identifier] = [
            "id": peripheral.identifier.uuidString,
            "name": name,
            "rssi": RSSI.intValue,
            "serviceUUIDs": serviceUUIDs,
            "manufacturerData": mfg,
        ]

        // Auto-connect to the first name match when a filter is set.
        if !connectFilter.isEmpty, target == nil,
           name.lowercased().contains(connectFilter) {
            target = peripheral
            peripheral.delegate = self
            central.stopScan()
            central.connect(peripheral, options: nil)
            connectedInfo = ["id": peripheral.identifier.uuidString, "name": name, "services": []]
        }

        writeSnapshot(status: "scanning")
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        connectedInfo["connected"] = true
        peripheral.discoverServices(nil)
        writeSnapshot(status: "connected")
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        connectedInfo["error"] = error?.localizedDescription ?? "connect failed"
        writeSnapshot(status: "connect-failed")
    }

    // MARK: - CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        var services = connectedInfo["services"] as? [[String: Any]] ?? []
        var chars: [[String: Any]] = []
        for c in service.characteristics ?? [] {
            chars.append(["uuid": c.uuid.uuidString, "properties": propNames(c.properties)])
            if c.properties.contains(.notify) || c.properties.contains(.indicate) {
                peripheral.setNotifyValue(true, for: c)
            }
        }
        services.append(["uuid": service.uuid.uuidString, "characteristics": chars])
        connectedInfo["services"] = services
        writeSnapshot(status: "enumerated")
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        frames.append([
            "char": characteristic.uuid.uuidString,
            "hex": data.hex,
            "len": data.count,
        ])
        if frames.count > 100 { frames.removeFirst(frames.count - 100) }
        writeSnapshot(status: "frame")
    }

    // MARK: - Snapshot

    private func writeSnapshot(status: String) {
        let snapshot: [String: Any] = [
            "status": status,
            "scanning": wantScan,
            "connectFilter": connectFilter,
            "devices": devices.values.sorted { ($0["rssi"] as? Int ?? -999) > ($1["rssi"] as? Int ?? -999) },
            "connected": connectedInfo,
            "frames": frames,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted]) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ble_scan.json")
        try? data.write(to: url, options: .atomic)
    }

    private func propNames(_ p: CBCharacteristicProperties) -> [String] {
        var out: [String] = []
        if p.contains(.read) { out.append("read") }
        if p.contains(.write) { out.append("write") }
        if p.contains(.writeWithoutResponse) { out.append("writeNoResp") }
        if p.contains(.notify) { out.append("notify") }
        if p.contains(.indicate) { out.append("indicate") }
        return out
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

// MARK: - C entry points (called from Rust)

@_silgen_name("ble_scan_start_c")
public func bleScanStartC(_ seconds: Double, _ connectFilterPtr: UnsafePointer<CChar>?) {
    let filter = connectFilterPtr.map { String(cString: $0) } ?? ""
    DispatchQueue.main.async {
        BleScaleScanner.shared.start(seconds: seconds, connectFilter: filter)
    }
}

@_silgen_name("ble_scan_stop_c")
public func bleScanStopC() {
    DispatchQueue.main.async { BleScaleScanner.shared.stop() }
}
#endif
