import Foundation
import SafariServices

// Called from Rust via extern "C" after blocked sites change.
@_silgen_name("apply_content_blocker_rules_c")
public func applyContentBlockerRules() {
    let tmp = FileManager.default.temporaryDirectory
        .appendingPathComponent("blockerRules.json")

    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker"
    ) else {
        return
    }

    let destURL = containerURL.appendingPathComponent("blockerRules.json")

    do {
        // removeItem throws NSFileNoSuchFileError if absent — that's fine, copyItem needs a clear path
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.copyItem(at: tmp, to: destURL)
    } catch {
        return
    }

    SFContentBlockerManager.reloadContentBlocker(
        withIdentifier: "com.bastianthomsen.timetracker.SafariBlocker"
    ) { _ in }
}
