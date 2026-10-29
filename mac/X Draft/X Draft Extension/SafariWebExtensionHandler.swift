//
//  SafariWebExtensionHandler.swift
//  X Draft Extension
//
//  Created by Alexander Heffernan on 29/10/2026.
//

import SafariServices
import AppKit

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        func reply(_ result: [String: Any]) {
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: result]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }

        guard let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any],
              message["action"] as? String == "share",
              let html = message["html"] as? String,
              html.utf8.count <= 40 * 1024 * 1024,
              html.hasPrefix("<!doctype html>") else {
            reply(["ok": false, "error": "Invalid HTML preview."])
            return
        }
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.hefferalex.XDraft") else {
            reply(["ok": false, "error": "The shared app container is unavailable. Sign both X Draft targets with the same team and App Group."])
            return
        }
        do {
            let directory = container.appendingPathComponent("Drafts", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            // Keep recent files available to Messages; never delete a file during a share.
            let old = Date().addingTimeInterval(-7 * 24 * 60 * 60)
            for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) {
                if file.pathExtension == "html", let date = try file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, date < old {
                    try? FileManager.default.removeItem(at: file)
                }
            }
            let id = UUID().uuidString
            let file = directory.appendingPathComponent("\(id).html")
            try html.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            DispatchQueue.main.async {
                // The URL contains an opaque identifier, never draft text or a file path.
                let opened = NSWorkspace.shared.open(URL(string: "xdraft://share/\(id)")!)
                reply(opened ? ["ok": true] : ["ok": false, "error": "Open the X Draft Mac app once, then try sharing again."])
            }
        } catch {
            reply(["ok": false, "error": "Could not save the preview: \(error.localizedDescription)"])
        }
    }
}
