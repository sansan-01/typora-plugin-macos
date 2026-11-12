import AppKit
import UniformTypeIdentifiers

struct PanelOptions: Decodable {
    struct Filter: Decodable {
        let extensions: [String]
    }

    struct MenuItem: Decodable {
        let id: Int?
        let title: String?
        let enabled: Bool?
        let checked: Bool?
        let shortcut: String?
        let hint: String?
        let command: Bool?
        let separator: Bool?
        let children: [MenuItem]?
    }

    let items: [MenuItem]?
    let minimumWidth: Double?
    let title: String?
    let defaultPath: String?
    let properties: [String]?
    let filters: [Filter]?
    let type: String?
    let message: String?
    let detail: String?
    let buttons: [String]?
    let defaultId: Int?
    let cancelId: Int?
    let checkboxLabel: String?
}

struct PanelResult: Encodable {
    let canceled: Bool
    var filePaths: [String]? = nil
    var filePath: String? = nil
    var response: Int? = nil
    var checkboxChecked: Bool? = nil
    var selected: Int? = nil
}

@MainActor
private final class MenuSelection: NSObject {
    var selected: Int?
    weak var menu: NSMenu?

    @objc func cancel(_ notification: Notification) {
        menu?.cancelTracking()
    }

    @objc func choose(_ item: NSMenuItem) {
        selected = item.tag
    }

    private func setShortcut(_ shortcut: String, for item: NSMenuItem) {
        var components = shortcut.lowercased().split(separator: "+", omittingEmptySubsequences: false)
        guard let last = components.popLast(), last.count == 1 else { return }
        var modifiers: NSEvent.ModifierFlags = []
        for modifier in components {
            switch modifier {
            case "ctrl", "cmd": modifiers.insert(.command)
            case "alt": modifiers.insert(.option)
            case "shift": modifiers.insert(.shift)
            default: return
            }
        }
        guard !modifiers.isEmpty else { return }
        item.keyEquivalent = String(last)
        item.keyEquivalentModifierMask = modifiers
    }

    func makeMenu(_ items: [PanelOptions.MenuItem], minimumWidth: Double) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.minimumWidth = CGFloat(minimumWidth)
        for item in items {
            if item.separator == true {
                menu.addItem(.separator())
                continue
            }
            let entry = NSMenuItem(title: item.title ?? "", action: nil, keyEquivalent: "")
            entry.isEnabled = item.enabled ?? true
            entry.state = item.checked == true ? .on : .off
            entry.toolTip = item.hint
            if item.command == true {
                entry.image = NSImage(systemSymbolName: "command", accessibilityDescription: nil)
            }
            if let children = item.children {
                entry.submenu = makeMenu(children, minimumWidth: minimumWidth)
            } else if let id = item.id {
                entry.tag = id
                entry.target = self
                entry.action = #selector(choose(_:))
                if let shortcut = item.shortcut {
                    setShortcut(shortcut, for: entry)
                }
            }
            menu.addItem(entry)
        }
        return menu
    }
}

private enum PanelError: LocalizedError {
    case inactive

    var errorDescription: String? {
        "Could not activate the native plugin menu"
    }
}

@MainActor
func showPanel(mode: String, options: PanelOptions) throws -> PanelResult {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let previousApp = NSWorkspace.shared.frontmostApplication
    app.finishLaunching()
    app.activate()

    if mode == "menu" {
        let deadline = Date().addingTimeInterval(0.5)
        while !app.isActive && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        guard app.isActive else { throw PanelError.inactive }
        let selection = MenuSelection()
        let minimumWidth = min(max(options.minimumWidth ?? 0, 0), 640)
        let menu = selection.makeMenu(options.items ?? [], minimumWidth: minimumWidth)
        selection.menu = menu
        NotificationCenter.default.addObserver(selection, selector: #selector(MenuSelection.cancel(_:)),
                                               name: NSApplication.didResignActiveNotification, object: app)
        defer { NotificationCenter.default.removeObserver(selection) }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        if app.isActive { previousApp?.activate() }
        return PanelResult(canceled: selection.selected == nil, selected: selection.selected)
    }

    if mode == "alert" {
        let alert = NSAlert()
        alert.messageText = options.message ?? options.title ?? ""
        alert.informativeText = options.detail ?? ""
        alert.alertStyle = options.type == "error" ? .critical : options.type == "warning" ? .warning : .informational
        let configuredTitles = options.buttons ?? []
        let titles = configuredTitles.isEmpty ? ["OK"] : configuredTitles
        for (index, title) in titles.enumerated() {
            let button = alert.addButton(withTitle: title)
            if index == (options.defaultId ?? 0) {
                button.keyEquivalent = "\r"
            } else if index == options.cancelId {
                button.keyEquivalent = "\u{1b}"
            } else {
                button.keyEquivalent = ""
            }
        }
        if let label = options.checkboxLabel, !label.isEmpty {
            alert.showsSuppressionButton = true
            alert.suppressionButton?.title = label
        }
        let selected = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        let response = titles.indices.contains(selected) ? selected : (options.cancelId ?? -1)
        return PanelResult(canceled: response == options.cancelId, response: response,
                           checkboxChecked: alert.suppressionButton?.state == .on)
    }

    let panel: NSSavePanel = mode == "open" ? NSOpenPanel() : NSSavePanel()
    if let title = options.title {
        panel.title = title
    }
    panel.canCreateDirectories = true
    let contentTypes = (options.filters ?? []).flatMap(\.extensions).compactMap {
        UTType(filenameExtension: $0)
    }
    panel.allowedContentTypes = contentTypes
    if let path = options.defaultPath, !path.isEmpty {
        var directory = ObjCBool(false)
        let exists = FileManager.default.fileExists(atPath: path, isDirectory: &directory)
        let url = URL(fileURLWithPath: path)
        panel.directoryURL = exists && directory.boolValue ? url : url.deletingLastPathComponent()
        if mode == "save" && !(exists && directory.boolValue) {
            panel.nameFieldStringValue = url.lastPathComponent
        }
    }

    if let openPanel = panel as? NSOpenPanel {
        let properties = options.properties ?? []
        openPanel.canChooseDirectories = properties.contains("openDirectory")
        openPanel.canChooseFiles = !openPanel.canChooseDirectories || properties.contains("openFile")
        openPanel.allowsMultipleSelection = properties.contains("multiSelections")
        let accepted = openPanel.runModal() == .OK
        return PanelResult(canceled: !accepted, filePaths: accepted ? openPanel.urls.map(\.path) : [])
    }

    let accepted = panel.runModal() == .OK
    return PanelResult(canceled: !accepted, filePath: accepted ? panel.url?.path : nil)
}

@main
struct FilePanel {
    @MainActor
    static func main() {
        do {
            let arguments = CommandLine.arguments
            if arguments.count == 2, arguments[1] == "fonts" {
                let families = NSFontManager.shared.availableFontFamilies
                FileHandle.standardOutput.write(try JSONEncoder().encode(families))
                return
            }
            if arguments.count == 3, ["activate", "running"].contains(arguments[1]) {
                let appURL = URL(fileURLWithPath: arguments[2]).resolvingSymlinksInPath()
                let app = NSWorkspace.shared.runningApplications.first {
                    $0.bundleURL?.resolvingSymlinksInPath().path == appURL.path
                }
                if arguments[1] == "running" { exit(app == nil ? 1 : 0) }
                exit(app?.activate() == true ? 0 : 1)
            }
            guard arguments.count == 2, ["open", "save", "alert", "menu"].contains(arguments[1]) else {
                exit(2)
            }
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let options = try JSONDecoder().decode(PanelOptions.self, from: data)
            let response = try showPanel(mode: arguments[1], options: options)
            FileHandle.standardOutput.write(try JSONEncoder().encode(response))
        } catch {
            FileHandle.standardError.write(Data(error.localizedDescription.utf8))
            exit(1)
        }
    }
}
