import SafariServices

class SafariContentBlockerHandler: NSObject, SFContentBlockerRequestHandler {
    func beginRequest(with context: NSExtensionContext) {
        let rulesURL: URL

        if let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.bastianthomsen.timetracker"
        ) {
            rulesURL = containerURL.appendingPathComponent("blockerRules.json")
        } else {
            // App Group unavailable (simulator / misconfigured entitlements) — use a temp file
            rulesURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("blockerRules.json")
        }

        // Seed an empty rule set if the file doesn't exist yet
        if !FileManager.default.fileExists(atPath: rulesURL.path) {
            try? "[]".data(using: .utf8)!.write(to: rulesURL)
        }

        let item = NSExtensionItem()
        if let attachment = NSItemProvider(contentsOf: rulesURL) {
            item.attachments = [attachment]
        }
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
