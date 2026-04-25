import Foundation
import SafariServices

// SFContentBlockerRequestHandler was removed from public headers in iOS 26 SDK beta.
// The protocol still exists at runtime (confirmed via SafariServices.tbd symbols).
// Declare it ourselves so the Swift compiler is satisfied.
@objc private protocol SFContentBlockerRequestHandler: NSObjectProtocol {
    func beginRequest(with context: NSExtensionContext)
}

final class SafariContentBlockerHandler: NSObject, SFContentBlockerRequestHandler {
    func beginRequest(with context: NSExtensionContext) {
        let fm = FileManager.default
        let rulesURL: URL

        if let containerURL = fm.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker"
        ) {
            rulesURL = containerURL.appendingPathComponent("blockerRules.json")
        } else {
            // App Group unavailable (simulator / misconfigured entitlements) — use a temp file
            rulesURL = fm.temporaryDirectory.appendingPathComponent("blockerRules.json")
        }

        // Seed an empty rule set if the file doesn't exist yet
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
