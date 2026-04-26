import Foundation
import SafariServices

// Called from Rust via extern "C" after blocked sites change.
@_silgen_name("apply_content_blocker_rules_c")
public func applyContentBlockerRules() {
    var log = "apply_content_blocker_rules_c called\n"

    let tmp = FileManager.default.temporaryDirectory
        .appendingPathComponent("blockerRules.json")
    log += "tmp exists: \(FileManager.default.fileExists(atPath: tmp.path))\n"

    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker"
    ) else {
        log += "FAIL: App Group container is nil\n"
        writeDebugLog(log)
        return
    }

    log += "App Group OK: \(containerURL.path)\n"
    let destURL = containerURL.appendingPathComponent("blockerRules.json")

    do {
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.copyItem(at: tmp, to: destURL)
        log += "File copy OK\n"
    } catch {
        log += "FAIL: copy error: \(error)\n"
        writeDebugLog(log)
        return
    }

    SFContentBlockerManager.reloadContentBlocker(
        withIdentifier: "com.bastianthomsen.timetracker.SafariBlocker"
    ) { error in
        log += error.map { "FAIL: reload error: \($0)\n" } ?? "Reload OK\n"
        // After a short delay, also capture what the extension wrote
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let extLogURL = containerURL.appendingPathComponent("ext_debug.txt")
            if let extLog = try? String(contentsOf: extLogURL) {
                log += "\n--- Extension log ---\n\(extLog)"
            } else {
                log += "\nExtension log not found (beginRequest never called?)\n"
            }
            writeDebugLog(log)
        }
    }
}

private func writeDebugLog(_ content: String) {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    let url = docs.appendingPathComponent("content_blocker_debug.txt")
    try? content.data(using: .utf8)?.write(to: url, options: .atomic)
}
