import Foundation

struct BridgeConfig: Decodable {
    let label: String
    let plist: String
    let port: Int
    let executable: String
}

func launchctl(_ arguments: [String]) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus == 0
    } catch {
        return false
    }
}

func startBridge(_ config: BridgeConfig) async {
    let domain = "gui/\(getuid())"
    let job = "\(domain)/\(config.label)"
    if !launchctl(["print", job]) {
        _ = launchctl(["bootstrap", domain, config.plist])
    }
    guard let url = URL(string: "http://127.0.0.1:\(config.port)/health") else { return }
    let sessionConfig = URLSessionConfiguration.ephemeral
    sessionConfig.timeoutIntervalForRequest = 0.4
    sessionConfig.timeoutIntervalForResource = 0.4
    let session = URLSession(configuration: sessionConfig)
    defer { session.invalidateAndCancel() }
    for _ in 0..<20 {
        if let (_, response) = try? await session.data(from: url),
           (response as? HTTPURLResponse)?.statusCode == 200 {
            return
        }
        try? await Task.sleep(for: .milliseconds(100))
    }
}

@main
struct LaunchTypora {
    static func main() async {
        let directory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        let configURL = directory.deletingLastPathComponent()
            .appendingPathComponent("Resources/typora-plugin-launch.json")
        let config = try? JSONDecoder().decode(BridgeConfig.self, from: Data(contentsOf: configURL))
        if let config {
            await startBridge(config)
        }
        let editor = directory.appendingPathComponent(config?.executable ?? "Typora").path
        let menuLibrary = directory.deletingLastPathComponent().appendingPathComponent("Frameworks/TyporaPluginMenu.dylib").path
        if FileManager.default.isReadableFile(atPath: menuLibrary) {
            setenv("DYLD_INSERT_LIBRARIES", menuLibrary, 1)
        }
        let arguments = [editor] + CommandLine.arguments.dropFirst()
        var argv = arguments.map { strdup($0) }
        argv.append(nil)
        execv(editor, &argv)
        exit(EXIT_FAILURE)
    }
}
