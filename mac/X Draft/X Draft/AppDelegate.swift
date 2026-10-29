//
//  AppDelegate.swift
//  X Draft
//
//  Created by Alexander Heffernan on 29/10/2026.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate, NSSharingServiceDelegate {
    private var sharingService: NSSharingService?
    private var sharingFile: URL?

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard url.scheme == "xdraft", url.host == "share",
                  let id = UUID(uuidString: String(url.path.dropFirst())),
                  let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.hefferalex.XDraft") else { continue }
            let source = container.appendingPathComponent("Drafts/\(id.uuidString).html")
            guard FileManager.default.fileExists(atPath: source.path) else {
                showError("The draft file is no longer available. Prepare it again from X.")
                continue
            }
            guard sharingService == nil else {
                showError("Finish or cancel the current Messages share before preparing another one.")
                continue
            }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("X-Draft-\(UUID().uuidString).html")
            do {
                // ShareKit can't delegate access to the App Group file. A copy
                // in this app's own sandbox can be handed to Messages instead.
                try FileManager.default.copyItem(at: source, to: file)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            } catch {
                try? FileManager.default.removeItem(at: file)
                showError("Couldn’t prepare the Messages attachment: \(error.localizedDescription) You can still use Save HTML in the extension.")
                continue
            }
            guard let service = NSSharingService(named: .composeMessage), service.canPerform(withItems: [file]) else {
                try? FileManager.default.removeItem(at: file)
                showError("Messages couldn’t accept this attachment. You can still use Save HTML in the extension and attach it in Messages manually.")
                continue
            }
            sharingFile = file
            sharingService = service
            service.delegate = self
            NSApp.activate(ignoringOtherApps: true)
            service.perform(withItems: [file])
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return sharingService == nil
    }

    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        finishSharing()
    }

    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        finishSharing()
        if (error as NSError).code != NSUserCancelledError { showError(error.localizedDescription) }
    }

    private func finishSharing() {
        sharingService = nil
        if let sharingFile { try? FileManager.default.removeItem(at: sharingFile) }
        sharingFile = nil
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Couldn’t share draft"
        alert.informativeText = message
        alert.runModal()
    }
}
