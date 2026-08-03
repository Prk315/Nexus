import Foundation
import SafariServices
import WebKit

private let kBlockerID = "com.bastianthomsen.nexuslocal.SafariBlocker"
private let kAppGroup  = "group.com.bastianthomsen.nexuslocal"

// Called from Rust via extern "C" after the blocked-site list changes.
// iOS 26 removed SFContentBlockerRequestHandler from the runtime — the handler
// class is never instantiated. Instead we compile rules directly into a
// WKContentRuleListStore stored inside the App Group (shared with the
// extension), then SFContentBlockerManager.reloadContentBlocker signals Safari
// to pick up the newly compiled bytecode. (Mirrors TimeTracker's working setup.)
@_silgen_name("apply_content_blocker_rules_c")
public func applyContentBlockerRules() {
    var log = "apply_content_blocker_rules_c called\n"

    let tmp = FileManager.default.temporaryDirectory
        .appendingPathComponent("blockerRules.json")

    guard let jsonData = try? Data(contentsOf: tmp),
          let jsonString = String(data: jsonData, encoding: .utf8) else {
        log += "FAIL: blockerRules.json unreadable at \(tmp.path)\n"
        writeDebugLog(log); return
    }
    log += "Read \(jsonData.count) bytes from tmp\n"

    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: kAppGroup
    ) else {
        log += "FAIL: App Group container is nil\n"
        writeDebugLog(log); return
    }

    // Keep the raw JSON in the App Group so the extension can also serve it
    // on iOS versions that still call beginRequest.
    let destURL = containerURL.appendingPathComponent("blockerRules.json")
    try? FileManager.default.removeItem(at: destURL)
    try? jsonData.write(to: destURL, options: .atomic)

    // Compile into both stores; whichever Safari reads wins.
    let storeURL = containerURL.appendingPathComponent("ContentRuleListStore", isDirectory: true)
    try? FileManager.default.createDirectory(at: storeURL, withIntermediateDirectories: true)
    let defaultStore = WKContentRuleListStore.default()
    let storeA = WKContentRuleListStore(url: storeURL)

    func compileInStores(_ remaining: [WKContentRuleListStore?], log: String) {
        let stores = remaining.compactMap { $0 }
        guard !stores.isEmpty else { doReload(log: log); return }
        var rest = stores
        let store = rest.removeFirst()
        store.compileContentRuleList(forIdentifier: kBlockerID,
                                     encodedContentRuleList: jsonString) { _, err in
            var l = log
            if let err = err {
                l += "Compile error (\(store === defaultStore ? "default" : "AppGroup")): \(err.localizedDescription)\n"
            } else {
                l += "Compiled OK (\(store === defaultStore ? "default" : "AppGroup"))\n"
            }
            compileInStores(rest.map { Optional($0) }, log: l)
        }
    }

    compileInStores([storeA, defaultStore], log: log)
}

private func doReload(log: String) {
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) {
        SFContentBlockerManager.reloadContentBlocker(withIdentifier: kBlockerID) { error in
            var l = log
            l += error == nil ? "reload OK\n" : "FAIL reload: \(String(describing: error))\n"
            writeDebugLog(l)
        }
    }
}

private func writeDebugLog(_ content: String) {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    let url = docs.appendingPathComponent("content_blocker_debug.txt")
    try? content.data(using: .utf8)?.write(to: url, options: .atomic)
}
