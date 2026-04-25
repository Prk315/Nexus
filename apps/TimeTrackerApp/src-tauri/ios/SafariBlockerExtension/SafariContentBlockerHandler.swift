import Foundation
import SafariServices

// SFContentBlockerRequestHandler was removed from iOS 26 SDK public headers but
// still exists at runtime (SafariServices.tbd). Declare it ourselves.
// IMPORTANT: The ObjC selector Safari calls is `beginRequestWithExtensionContext:`
// (from the original ObjC definition). Without the explicit @objc name annotation,
// Swift would generate `beginRequestWith:` instead — a selector Safari never calls.
@objc protocol SFContentBlockerRequestHandler: NSObjectProtocol {
    @objc(beginRequestWithExtensionContext:)
    func beginRequest(with context: NSExtensionContext)
}

@objc(SafariContentBlockerHandler)
final class SafariContentBlockerHandler: NSObject, SFContentBlockerRequestHandler {

    @objc(beginRequestWithExtensionContext:)
    func beginRequest(with context: NSExtensionContext) {
        let fm = FileManager.default
        let rulesURL: URL

        if let containerURL = fm.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker"
        ) {
            rulesURL = containerURL.appendingPathComponent("blockerRules.json")
        } else {
            rulesURL = fm.temporaryDirectory.appendingPathComponent("blockerRules.json")
        }

        if !fm.fileExists(atPath: rulesURL.path) {
            try? Data("[]".utf8).write(to: rulesURL, options: .atomic)
        }

        let item = NSExtensionItem()
        if let attachment = NSItemProvider(contentsOf: rulesURL) {
            item.attachments = [attachment]
        }
        context.completeRequest(returningItems: [item])
    }
}
