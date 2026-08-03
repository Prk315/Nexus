#if os(iOS)
import CoreBluetooth
import Foundation

/// Protocol-agnostic BLE recon scanner + writer. Fingerprints nearby devices
/// (name, RSSI, advertised service UUIDs, manufacturer data) and — when given a
/// name filter — connects to the first match, enumerates its GATT, subscribes to
/// every notifiable characteristic, and captures the raw frames (hex) it emits.
///
/// For body-composition scales that only stream weight until the app sends a
/// handshake, it can also WRITE a configurable command to a characteristic
/// (default FFF1) right after enumeration, and expose a manual write so handshake
/// byte sequences can be tried live without rebuilding the app.
///
/// Everything is written as JSON to tmp/ble_scan.json for the Rust/JS layer.
/// NOTE: CoreBluetooth does nothing in the iOS Simulator — physical device only.
final class BleScaleScanner: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = BleScaleScanner()

    private var central: CBCentralManager?
    private var devices: [UUID: [String: Any]] = [:]
    private var frames: [[String: Any]] = []
    private var log: [String] = []
    private var connectFilter: String = ""
    private var target: CBPeripheral?          // strong ref while connected
    private var connectedInfo: [String: Any] = [:]
    private var charsByUUID: [String: CBCharacteristic] = [:]  // "FFF1" -> char
    private var wantScan = false
    private var backgroundMode = false

    // Auto-handshake: after enumerating, write these bytes to `handshakeChar`.
    private var handshakeHex = ""
    private var handshakeChar = "FFF1"
    private var didHandshake = false

    // MARK: - Control

    func start(seconds: Double, connectFilter: String, handshakeHex: String, handshakeChar: String) {
        self.connectFilter = connectFilter.lowercased()
        self.handshakeHex = handshakeHex.replacingOccurrences(of: " ", with: "")
        self.handshakeChar = handshakeChar.isEmpty ? "FFF1" : handshakeChar.uppercased()
        self.didHandshake = false
        self.backgroundMode = connectFilter.isEmpty   // pure-scan runs can survive backgrounding
        devices.removeAll(); frames.removeAll(); log.removeAll()
        connectedInfo.removeAll(); charsByUUID.removeAll()
        target = nil
        wantScan = true

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

    /// Manually write `hex` to a characteristic (by short UUID, e.g. "FFF1") on the
    /// connected peripheral — for trying handshake sequences live.
    func write(hex: String, charUUID: String) {
        writeCommand(hex: hex.replacingOccurrences(of: " ", with: ""),
                     charUUID: charUUID.uppercased(), reason: "manual")
    }

    private func beginScan() {
        // Background scanning requires an explicit service filter; foreground can
        // scan for everything with duplicates so RSSI/mfg data refresh live.
        let services: [CBUUID]? = backgroundMode ? [CBUUID(string: "FFF0")] : nil
        let opts: [String: Any] = backgroundMode
            ? [:]
            : [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        central?.scanForPeripherals(withServices: services, options: opts)
        note(backgroundMode ? "scanning FFF0 (bg-capable)" : "scanning all")
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

        // Record the mfg data over time so a measurement broadcast (triggered by
        // another app's handshake) shows up as a changing advertisement.
        var entry = devices[peripheral.identifier] ?? [:]
        let prevMfg = entry["manufacturerData"] as? String
        entry["id"] = peripheral.identifier.uuidString
        entry["name"] = name
        entry["rssi"] = RSSI.intValue
        entry["serviceUUIDs"] = serviceUUIDs
        entry["manufacturerData"] = mfg
        if let prev = prevMfg, prev != mfg, !mfg.isEmpty {
            var adv = entry["advHistory"] as? [String] ?? []
            adv.append(mfg)
            if adv.count > 12 { adv.removeFirst(adv.count - 12) }
            entry["advHistory"] = adv
            note("adv change \(name.isEmpty ? peripheral.identifier.uuidString.prefix(8).description : name): \(mfg)")
        }
        devices[peripheral.identifier] = entry

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
        note("connected \(peripheral.name ?? "")")
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
            charsByUUID[c.uuid.uuidString.uppercased()] = c
            if c.properties.contains(.notify) || c.properties.contains(.indicate) {
                peripheral.setNotifyValue(true, for: c)
            }
        }
        services.append(["uuid": service.uuid.uuidString, "characteristics": chars])
        connectedInfo["services"] = services
        writeSnapshot(status: "enumerated")

        // Once the handshake target characteristic is known, fire the handshake.
        if !handshakeHex.isEmpty, !didHandshake, charsByUUID[handshakeChar] != nil {
            didHandshake = true
            // Small delay so notifications are subscribed before we trigger.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                guard let self else { return }
                self.writeCommand(hex: self.handshakeHex, charUUID: self.handshakeChar,
                                  reason: "auto-handshake")
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        note("write ack \(characteristic.uuid.uuidString)\(error.map { " err:\($0.localizedDescription)" } ?? " ok")")
        writeSnapshot(status: "wrote")
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        frames.append([
            "char": characteristic.uuid.uuidString,
            "hex": data.hex,
            "len": data.count,
        ])
        if frames.count > 500 { frames.removeFirst(frames.count - 500) }  // keep a full session
        writeSnapshot(status: "frame")
    }

    // MARK: - Writing

    private func writeCommand(hex: String, charUUID: String, reason: String) {
        guard let peripheral = target else { note("write skipped: not connected"); writeSnapshot(status: "no-conn"); return }
        guard let c = charsByUUID[charUUID.uppercased()] else {
            note("write skipped: char \(charUUID) not found"); writeSnapshot(status: "no-char"); return
        }
        guard let data = Self.dataFromHex(hex), !data.isEmpty else {
            note("write skipped: bad hex '\(hex)'"); writeSnapshot(status: "bad-hex"); return
        }
        let type: CBCharacteristicWriteType =
            c.properties.contains(.write) ? .withResponse : .withoutResponse
        peripheral.writeValue(data, for: c, type: type)
        note("\(reason) write \(charUUID) <- \(hex) (\(type == .withResponse ? "resp" : "noResp"))")
        writeSnapshot(status: "writing")
    }

    private static func dataFromHex(_ hex: String) -> Data? {
        let s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count % 2 == 0 else { return nil }
        var out = Data(capacity: s.count / 2)
        var idx = s.startIndex
        while idx < s.endIndex {
            let next = s.index(idx, offsetBy: 2)
            guard let b = UInt8(s[idx..<next], radix: 16) else { return nil }
            out.append(b)
            idx = next
        }
        return out
    }

    // MARK: - Snapshot

    private func note(_ s: String) {
        log.append(s)
        if log.count > 30 { log.removeFirst(log.count - 30) }
    }

    private func writeSnapshot(status: String) {
        let snapshot: [String: Any] = [
            "status": status,
            "scanning": wantScan,
            "connectFilter": connectFilter,
            "devices": devices.values.sorted { ($0["rssi"] as? Int ?? -999) > ($1["rssi"] as? Int ?? -999) },
            "connected": connectedInfo,
            "frames": frames,
            "log": log,
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
public func bleScanStartC(_ seconds: Double,
                          _ connectFilterPtr: UnsafePointer<CChar>?,
                          _ handshakeHexPtr: UnsafePointer<CChar>?,
                          _ handshakeCharPtr: UnsafePointer<CChar>?) {
    let filter = connectFilterPtr.map { String(cString: $0) } ?? ""
    let hs = handshakeHexPtr.map { String(cString: $0) } ?? ""
    let hc = handshakeCharPtr.map { String(cString: $0) } ?? "FFF1"
    DispatchQueue.main.async {
        BleScaleScanner.shared.start(seconds: seconds, connectFilter: filter,
                                     handshakeHex: hs, handshakeChar: hc)
    }
}

@_silgen_name("ble_write_c")
public func bleWriteC(_ hexPtr: UnsafePointer<CChar>?, _ charPtr: UnsafePointer<CChar>?) {
    let hex = hexPtr.map { String(cString: $0) } ?? ""
    let ch = charPtr.map { String(cString: $0) } ?? "FFF1"
    DispatchQueue.main.async { BleScaleScanner.shared.write(hex: hex, charUUID: ch) }
}

@_silgen_name("ble_scan_stop_c")
public func bleScanStopC() {
    DispatchQueue.main.async { BleScaleScanner.shared.stop() }
}
#endif
