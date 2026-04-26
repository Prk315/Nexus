import Foundation

// iOS 26 removed SFContentBlockerRequestHandler from SafariServices entirely.
// Declaring a local version of that protocol risks breaking extension validation
// on iOS 26 (the system may reject extensions claiming conformance to a protocol
// it no longer recognises). Instead we conform directly to NSExtensionRequestHandling,
// which is the actual base protocol that all extension handlers implement.
// If iOS 26 ever resumes calling the handler, it will land here.
final class SafariContentBlockerHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let kAppGroup = "group.com.bastianthomsen.timetracker"

        // Sentinel so we can detect if this method is ever called.
        if let g = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: kAppGroup
        ) {
            try? "beginRequest called (NSExtensionRequestHandling)".data(using: .utf8)?
                .write(to: g.appendingPathComponent("ext_debug.txt"), options: .atomic)

            // Serve rules that the main app wrote to the App Group.
            let rulesURL = g.appendingPathComponent("blockerRules.json")
            if FileManager.default.fileExists(atPath: rulesURL.path) {
                let item = NSExtensionItem()
                if let attachment = NSItemProvider(contentsOf: rulesURL) {
                    item.attachments = [attachment]
                    context.completeRequest(returningItems: [item])
                    return
                }
            }
        }

        // Final fallback: static bundle rules.
        if let bundleURL = Bundle.main.url(forResource: "blockerList", withExtension: "json") {
            let item = NSExtensionItem()
            if let attachment = NSItemProvider(contentsOf: bundleURL) {
                item.attachments = [attachment]
                context.completeRequest(returningItems: [item])
                return
            }
        }

        context.completeRequest(returningItems: [])
    }
}
