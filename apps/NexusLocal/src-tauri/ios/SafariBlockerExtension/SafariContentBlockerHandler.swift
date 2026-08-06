import Foundation

// iOS 26 removed SFContentBlockerRequestHandler from SafariServices. Conform
// directly to NSExtensionRequestHandling (the real base protocol) — declaring a
// local copy of the removed protocol makes iOS 26 silently refuse to load the
// extension. Do NOT add an @objc(...) class annotation; the principal class is
// resolved via $(PRODUCT_MODULE_NAME).SafariContentBlockerHandler in Info.plist.
final class SafariContentBlockerHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        // Resolved at runtime (not hardcoded) so it matches the group SideStore
        // actually assigns during re-signing — same resolver the app and widget
        // targets use. See ios/AppGroup.swift.
        if let g = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppGroup.identifier
        ) {
            try? "beginRequest called".data(using: .utf8)?
                .write(to: g.appendingPathComponent("ext_debug.txt"), options: .atomic)

            // Serve rules the main app wrote to the App Group.
            let rulesURL = g.appendingPathComponent("blockerRules.json")
            if FileManager.default.fileExists(atPath: rulesURL.path),
               let attachment = NSItemProvider(contentsOf: rulesURL) {
                let item = NSExtensionItem()
                item.attachments = [attachment]
                context.completeRequest(returningItems: [item])
                return
            }
        }

        // Fallback: static bundled rules.
        if let bundleURL = Bundle.main.url(forResource: "blockerList", withExtension: "json"),
           let attachment = NSItemProvider(contentsOf: bundleURL) {
            let item = NSExtensionItem()
            item.attachments = [attachment]
            context.completeRequest(returningItems: [item])
            return
        }

        context.completeRequest(returningItems: [])
    }
}
