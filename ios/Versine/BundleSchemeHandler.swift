import Foundation
import WebKit

/// Serves the web app from the app bundle (Web/, copied there by
/// bundle-web.sh) at versine://localhost/.
///
/// A custom scheme rather than file:// because module scripts and fetch() need
/// a real origin, and file:// pages have none. /api/ is the one path the bundle
/// cannot answer: it is a Vercel function, so it is forwarded to the deployed
/// site.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "versine"

    private let root = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true).standardizedFileURL
    private let api = URL(string: "https://versine.vercel.app")!
    /// Tasks WebKit has cancelled. Answering one of them raises an exception.
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path

        if path.hasPrefix("/api/") {
            forward(task, path: path, query: url.query)
            return
        }

        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            respond(task, status: 404, type: "text/plain", data: Data())
            return
        }
        respond(task, status: 200, type: Self.mimeType(file.pathExtension), data: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func forward(_ task: WKURLSchemeTask, path: String, query: String?) {
        var components = URLComponents(url: api, resolvingAgainstBaseURL: false)!
        components.path = path
        components.query = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = task.request.httpMethod ?? "GET"

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                let http = response as? HTTPURLResponse
                self?.respond(task, status: http?.statusCode ?? 502,
                              type: http?.value(forHTTPHeaderField: "Content-Type") ?? "application/json",
                              data: data ?? Data())
            }
        }.resume()
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, type: String, data: Data) {
        guard stopped.remove(ObjectIdentifier(task)) == nil, let url = task.request.url else { return }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json; charset=utf-8"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "webp": "image/webp"
        case "wasm": "application/wasm"
        default: "application/octet-stream"
        }
    }
}
