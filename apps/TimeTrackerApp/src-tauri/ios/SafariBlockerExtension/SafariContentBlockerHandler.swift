import Foundation
import SafariServices

// SFContentBlockerRequestHandler was removed from iOS 26 SDK public headers.
// Test: return hardcoded rules for youtube.com — if this blocks youtube in Safari
// then beginRequest IS being called and the handler mechanism works on iOS 26.
@objc protocol SFContentBlockerRequestHandler: NSObjectProtocol {
    @objc(beginRequestWithExtensionContext:)
    func beginRequest(with context: NSExtensionContext)
}

@objc(SafariContentBlockerHandler)
final class SafariContentBlockerHandler: NSObject, SFContentBlockerRequestHandler {

    @objc(beginRequestWithExtensionContext:)
    func beginRequest(with context: NSExtensionContext) {
        // Hardcoded test rule — blocks youtube.com regardless of App Group
        let testRules = """
        [{"trigger":{"url-filter":".*youtube\\\\.com.*"},"action":{"type":"block"}}]
        """

        // Write sentinel so we know beginRequest was called
        if let g = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker") {
            try? "beginRequest called with hardcoded rules".data(using: .utf8)?
                .write(to: g.appendingPathComponent("ext_debug.txt"), options: .atomic)
        }

        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("test_rules.json")
        try? testRules.data(using: .utf8)?.write(to: tmpURL, options: .atomic)

        let item = NSExtensionItem()
        if let attachment = NSItemProvider(contentsOf: tmpURL) {
            item.attachments = [attachment]
        }
        context.completeRequest(returningItems: [item])
    }
}
