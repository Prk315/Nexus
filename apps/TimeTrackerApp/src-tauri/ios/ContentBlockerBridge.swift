import Foundation
import SafariServices
import WebKit

private let kBlockerID = "com.bastianthomsen.timetracker.SafariBlocker"
private let kAppGroup  = "group.com.bastianthomsen.timetracker"

// Called from Rust via extern "C" after blocked sites change.
// iOS 26 removed SFContentBlockerRequestHandler from the runtime — the handler
// class is never instantiated. Instead we compile rules directly into a
// WKContentRuleListStore stored inside the App Group, which both the main app
// and the extension share. SFContentBlockerManager.reloadContentBlocker then
// signals Safari to pick up the newly compiled bytecode.
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
    log += "JSON: \(jsonString.prefix(300))\n"

    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: kAppGroup
    ) else {
        log += "FAIL: App Group container is nil\n"
        writeDebugLog(log); return
    }
    log += "App Group OK: \(containerURL.path)\n"

    // Keep the raw JSON in the App Group so the extension can also serve it
    // on iOS versions that still call beginRequest.
    let destURL = containerURL.appendingPathComponent("blockerRules.json")
    try? FileManager.default.removeItem(at: destURL)
    try? jsonData.write(to: destURL, options: .atomic)

    // Try both stores so we can see which one (if any) Safari reads from.

    // Store A: App Group (shared with extension process)
    let storeURL = containerURL.appendingPathComponent("ContentRuleListStore", isDirectory: true)
    try? FileManager.default.createDirectory(at: storeURL, withIntermediateDirectories: true)

    // Store B: app's own default store (Library/WebKit/ContentRuleListStore)
    let defaultStore = WKContentRuleListStore.default()

    let storeA = WKContentRuleListStore(url: storeURL)
    log += "StoreA (App Group) available: \(storeA != nil)\n"
    log += "StoreB (default) available: \(defaultStore != nil)\n"

    func compileInStores(_ remaining: [WKContentRuleListStore?], log: String) {
        let stores = remaining.compactMap { $0 }
        guard !stores.isEmpty else {
            doReload(log: log)
            return
        }
        var rest = stores
        let store = rest.removeFirst()
        store.compileContentRuleList(forIdentifier: kBlockerID,
                                     encodedContentRuleList: jsonString) { _, err in
            var l = log
            if let err = err {
                l += "Compile error in \(store === defaultStore ? "default" : "AppGroup") store: \(err.localizedDescription)\n"
            } else {
                l += "Compiled OK in \(store === defaultStore ? "default" : "AppGroup") store\n"
            }
            compileInStores(rest.map { Optional($0) }, log: l)
        }
    }

    compileInStores([storeA, defaultStore], log: log)
}

private func doReload(log: String) {
    // Wait briefly for extension to run (if beginRequest is called).
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) {
        // Check if the extension's beginRequest sentinel was written.
        var log2 = log
        if let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: kAppGroup
        ) {
            let extLogURL = containerURL.appendingPathComponent("ext_debug.txt")
            if let extLog = try? String(contentsOf: extLogURL) {
                log2 += "Extension beginRequest WAS called: \(extLog)\n"
            } else {
                log2 += "Extension beginRequest NOT called (ext_debug.txt absent)\n"
            }
        }
        SFContentBlockerManager.reloadContentBlocker(withIdentifier: kBlockerID) { error in
            if let error = error {
                log2 += "FAIL: reload: \(error)\n"
            } else {
                log2 += "reload OK\n"
            }
            writeDebugLog(log2)
        }
    }
}

private func writeDebugLog(_ content: String) {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    let url = docs.appendingPathComponent("content_blocker_debug.txt")
    try? content.data(using: .utf8)?.write(to: url, options: .atomic)
}
