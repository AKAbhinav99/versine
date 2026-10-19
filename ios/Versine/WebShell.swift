import SafariServices
import UIKit
import WebKit

/// Where the web app says it is: sent on every screen change (src/app/shell.js).
struct WebRoute {
    let screen: String
    let tab: AppTab?
    let showsTabBar: Bool

    init(_ body: [String: Any]) {
        screen = body["screen"] as? String ?? ""
        tab = (body["tab"] as? String).flatMap(AppTab.init(webName:))
        showsTabBar = body["tabBar"] as? Bool ?? true
    }
}

/// Hosts the web app and is its way into the platform.
///
/// The page is served from the app bundle at versine://localhost/ (see
/// BundleSchemeHandler). A `localhost` host is a secure context to WebKit, so
/// the camera, location and module scripts behave exactly as they do on the
/// deployed site.
///
/// The bridge is small on purpose. The page posts `{ type, ... }` messages to
/// `window.webkit.messageHandlers.versine`, and the script injected below wraps
/// that as `window.VersineNative`. Everything the web app does through it it can
/// also do without it, so the same files still run as a website.
final class WebShell: NSObject {
    let webView: WKWebView
    weak var presenter: UIViewController?
    var onRoute: ((WebRoute) -> Void)?

    private let locator = Locator()

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        configuration.userContentController.add(WeakMessageHandler(self), name: "versine")

        let page = UIColor(named: "LaunchBackground")
        webView.isOpaque = false
        webView.backgroundColor = page
        webView.scrollView.backgroundColor = page
        // The page lays itself out around the notch and the tab bar with
        // env(safe-area-inset-*), so the scroll view must not inset it again.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        webView.uiDelegate = self
        webView.navigationDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
    }

    func start() {
        // The intro's scroll story (GSAP, Lenis, three.js) and the web fonts are
        // website-only: the app uses the system font and no scroll scenes. They
        // are blocked rather than left to download and go unused. The rule list
        // compiles asynchronously and must be in place before the first load.
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "website-only", encodedContentRuleList: Self.blockList
        ) { [weak self] list, error in
            guard let self else { return }
            if let list { self.webView.configuration.userContentController.add(list) }
            #if DEBUG
            if let error { NSLog("[web] block list did not compile: %@", String(describing: error)) }
            #endif
            self.webView.load(URLRequest(url: Self.startURL))
        }
    }

    /// Selects a tab in the web app, as a tap on its own tab bar would.
    func select(_ tab: AppTab) {
        webView.evaluateJavaScript("window.VersineApp?.selectTab('\(tab.webName)')")
    }

    private static var startURL: URL {
        var url = URL(string: "\(BundleSchemeHandler.scheme)://localhost/")!
        #if DEBUG
        // `-demo` on launch opens the web app's ?demo result fixture, for working
        // on the result screen in a simulator that has no camera.
        if ProcessInfo.processInfo.arguments.contains("-demo") {
            url = URL(string: "\(BundleSchemeHandler.scheme)://localhost/?demo")!
        }
        #endif
        return url
    }

    /// One rule per URL prefix: WebKit's content-blocker patterns have no
    /// alternation, and a list with an `(a|b)` in it fails to compile at all.
    private static let blockList: String = {
        let prefixes = [
            "^https://cdn\\.jsdelivr\\.net/npm/gsap@",
            "^https://cdn\\.jsdelivr\\.net/npm/lenis@",
            "^https://cdn\\.jsdelivr\\.net/npm/three@",
            "^https://fonts\\.googleapis\\.com/",
            "^https://fonts\\.gstatic\\.com/",
        ]
        let rules = prefixes.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        let json = try! JSONSerialization.data(withJSONObject: rules)
        return String(decoding: json, as: UTF8.self)
    }()

    #if DEBUG
    /// Page errors and warnings, into the device log as "[web error] ...".
    private static let consoleScript = """
    (() => {
      const send = (level, parts) => window.webkit.messageHandlers.versine.postMessage({
        type: 'log', level, text: parts.map((part) => part instanceof Error ? `${part.message}\\n${part.stack}` : String(part)).join(' '),
      });
      for (const level of ['error', 'warn']) {
        const original = console[level];
        console[level] = (...parts) => { send(level, parts); original.apply(console, parts); };
      }
      addEventListener('error', (event) => send('error', [`${event.message} at ${event.filename}:${event.lineno}`]));
      addEventListener('unhandledrejection', (event) => send('error', ['unhandled rejection:', event.reason]));
    })();
    """
    #endif

    #if targetEnvironment(simulator)
    private static let isSimulator = true
    #else
    private static let isSimulator = false
    #endif

    /// Runs before any of the page's own scripts.
    private static let bridgeScript = """
    (() => {
      const post = (message) => window.webkit.messageHandlers.versine.postMessage(message);

      const waiting = new Map();
      let next = 0;
      const settle = (id, result) => {
        const request = waiting.get(id);
        if (!request) return;
        waiting.delete(id);
        clearTimeout(request.timer);
        if ('lat' in result) {
          request.success?.({
            coords: { latitude: result.lat, longitude: result.lng, accuracy: result.accuracy },
            timestamp: Date.now(),
          });
        } else {
          request.failure?.({ code: result.code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        }
      };

      window.VersineNative = {
        platform: 'ios',
        simulator: \(isSimulator),
        route: (detail) => post({ type: 'route', ...detail }),
        haptic: (style) => post({ type: 'haptic', style }),
        open: (url) => post({ type: 'open', url: String(url) }),
        print: () => post({ type: 'print' }),
        sharePDF: (name) => post({ type: 'sharePDF', name: String(name || 'Versine report') }),
        _located: settle,
      };

      // Reports print through the iOS print sheet, from the same PDF Share
      // PDF produces (exportPDF), so the end of a long report is never lost.
      window.print = () => window.VersineNative.print();

      // Location through Core Location, so the permission prompt is the app's
      // own rather than WebKit's, which names "localhost".
      const geolocation = {
        getCurrentPosition(success, failure, options = {}) {
          const id = ++next;
          const timeout = Number.isFinite(options.timeout) ? options.timeout : 0;
          const timer = timeout ? setTimeout(() => settle(id, { code: 3 }), timeout) : 0;
          waiting.set(id, { success, failure, timer });
          post({ type: 'locate', id });
        },
        watchPosition(success, failure, options) { this.getCurrentPosition(success, failure, options); return 0; },
        clearWatch() {},
      };
      Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    })();
    """
}

// MARK: - Messages from the page

extension WebShell: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "route":
            onRoute?(WebRoute(body))
        case "haptic":
            Haptics.play(body["style"] as? String)
        case "open":
            if let text = body["url"] as? String, let url = URL(string: text) { open(url) }
        case "print":
            printPage()
        case "sharePDF":
            sharePDF(named: body["name"] as? String ?? "Versine report")
        case "locate":
            locate(id: body["id"] as? Int ?? 0)
        #if DEBUG
        case "log":
            NSLog("[web %@] %@", body["level"] as? String ?? "log", body["text"] as? String ?? "")
        #endif
        default:
            break
        }
    }

    private func locate(id: Int) {
        locator.locate { [weak self] result in
            let payload: String
            switch result {
            case .success(let location):
                let c = location.coordinate
                payload = "{lat: \(c.latitude), lng: \(c.longitude), accuracy: \(location.horizontalAccuracy)}"
            case .failure(let code):
                payload = "{code: \(code.rawValue)}"
            }
            self?.webView.evaluateJavaScript("window.VersineNative._located(\(id), \(payload))")
        }
    }

    /// The page's print layout (styles/print.css) as a finished PDF.
    ///
    /// WebKit counts a document's pages before the breaks that keep a section
    /// together push it onto the next page, so a report with several such
    /// breaks comes out a page or more short and loses its end, in the print
    /// sheet too. While rendering, html.pdf-export pads the end of the report
    /// (print.css) so the count has room; PDFRenderer drops the blank pages
    /// the padding leaves. Print and Share both go through here.
    private func exportPDF(_ done: @escaping (Data) -> Void) {
        webView.evaluateJavaScript("document.documentElement.classList.add('pdf-export')") { [weak self] _, _ in
            guard let self else { return }
            let data = PDFRenderer.render(self.webView.viewPrintFormatter())
            self.webView.evaluateJavaScript("document.documentElement.classList.remove('pdf-export')")
            done(data)
        }
    }

    private func printPage() {
        exportPDF { data in
            let info = UIPrintInfo.printInfo()
            info.jobName = "Versine report"
            info.outputType = .general
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printingItem = data
            controller.present(animated: true)
        }
    }

    /// The report as a PDF file, through the share sheet: Mail, Messages,
    /// AirDrop, Files. It is the page's print layout (styles/print.css), the
    /// same PDF the Print button prints, laid out on the paper size the phone's
    /// region uses, and written to the app's temporary folder only.
    private func sharePDF(named name: String) {
        exportPDF { [weak self] data in
            guard let self else { return }
            let safeName = name.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: "-")
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).pdf")
            do {
                try data.write(to: file, options: .atomic)
            } catch {
                return self.printPage()   // the print sheet can still save a PDF
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file) }
            sheet.popoverPresentationController?.sourceView = self.webView
            self.presenter?.present(sheet, animated: true)
            Haptics.play("light")
        }
    }

    /// Web pages open in an in-app Safari sheet; anything else (phone numbers,
    /// maps, mail) goes to the app that handles it.
    private func open(_ url: URL) {
        if let maps = Self.appleMapsDirections(for: url) {
            UIApplication.shared.open(maps)
            return
        }
        guard ["http", "https"].contains(url.scheme?.lowercased()) else {
            UIApplication.shared.open(url)
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = UIColor(named: "AccentColor")
        presenter?.present(safari, animated: true)
    }


    /// The web app's directions links are Google Maps routes to a coordinate
    /// (src/lib/clinics.js). On an iPhone, directions belong in Maps.
    private static func appleMapsDirections(for url: URL) -> URL? {
        guard url.host?.hasSuffix("google.com") == true, url.path.hasPrefix("/maps/dir"),
              let destination = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "destination" })?.value
        else { return nil }
        var maps = URLComponents(string: "https://maps.apple.com/")!
        maps.queryItems = [URLQueryItem(name: "daddr", value: destination)]
        return maps.url
    }
}

// MARK: - Navigation

extension WebShell: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        if [BundleSchemeHandler.scheme, "about", "blob", "data"].contains(scheme) {
            return decisionHandler(.allow)
        }
        // Subframes (map attribution, embeds) load in place; a page leaving the
        // app opens in Safari instead of replacing it.
        if action.targetFrame?.isMainFrame == false {
            return decisionHandler(.allow)
        }
        open(url)
        decisionHandler(.cancel)
    }

    // WebKit can drop the page's process under memory pressure, which otherwise
    // leaves a blank screen. The scans are in storage, so a reload loses nothing.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

// MARK: - Dialogs, camera, new windows

extension WebShell: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { open(url) }
        return nil
    }

    // iOS has already asked for the camera on the app's behalf (with
    // NSCameraUsageDescription); WebKit's second, per-page prompt would only
    // repeat the question, naming "localhost".
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "localhost" ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, otherwise: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        // The web app only asks to confirm clearing answers or deleting scans.
        let verb = message.hasPrefix("Clear") ? "Clear" : "Delete"
        alert.addAction(UIAlertAction(title: verb, style: .destructive) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
    }

    private func present(_ alert: UIAlertController, otherwise fallback: @escaping () -> Void) {
        guard let presenter, presenter.presentedViewController == nil else { return fallback() }
        presenter.present(alert, animated: true)
    }
}

/// WKUserContentController holds its handlers strongly, which would keep the
/// shell, and its web view, alive for good.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
