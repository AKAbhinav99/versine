import UIKit

/// The app's five sections, in tab order. `webName` is the same tab's name in
/// the web app (`data-tab` in index.html, `TAB_OF` in src/router.js).
enum AppTab: Int, CaseIterable {
    case home, scan, care, learn, log

    var webName: String {
        switch self {
        case .home: "home"
        case .scan: "capture"
        case .care: "doctors"
        case .learn: "resources"
        case .log: "history"
        }
    }

    var title: String {
        switch self {
        case .home: "Home"
        case .scan: "Scan"
        case .care: "Care"
        case .learn: "Learn"
        case .log: "Log"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .scan: "viewfinder"
        case .care: "stethoscope"
        case .learn: "book"
        case .log: "chart.xyaxis.line"
        }
    }

    init?(webName: String) {
        guard let tab = AppTab.allCases.first(where: { $0.webName == webName }) else { return nil }
        self = tab
    }
}

/// A real iOS tab bar over the web app.
///
/// There is one web view, not one per tab: the scan flow, the log and the
/// clinician finder share state (a scan just taken is in the log; "Find
/// clinicians" on a result opens Care), and the web app already routes between
/// them. So the web view moves into whichever tab is showing, and the two sides
/// keep each other in step: a tap here selects the web app's tab, and a screen
/// change there selects the tab here (`WebRoute`).
final class AppTabBarController: UITabBarController, UITabBarControllerDelegate {
    private let shell = WebShell()

    private lazy var hosts: [UIViewController] = AppTab.allCases.map { tab in
        let host = UIViewController()
        host.view.backgroundColor = UIColor(named: "LaunchBackground")
        host.tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbol), tag: tab.rawValue)
        return host
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        setViewControllers(hosts, animated: false)
        // Until the web app reports where it opened: the disclaimer gate, which
        // shows no tabs, is the first screen anyone sees.
        setTabBarHidden(true, animated: false)

        shell.presenter = self
        shell.onRoute = { [weak self] route in self?.apply(route) }
        dock(in: hosts[0])
        shell.start()
    }

    // Also called when the selected tab is tapped again, which takes the web
    // app back to that tab's first screen, as a second tap does in any iOS app.
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard let tab = AppTab(rawValue: viewController.tabBarItem.tag) else { return }
        dock(in: viewController)
        Haptics.play("selection")
        shell.select(tab)
    }

    private func apply(_ route: WebRoute) {
        if let tab = route.tab, selectedIndex != tab.rawValue {
            selectedIndex = tab.rawValue
            dock(in: hosts[tab.rawValue])
        }
        if isTabBarHidden == route.showsTabBar {
            setTabBarHidden(!route.showsTabBar, animated: true)
        }
    }

    private func dock(in host: UIViewController) {
        let web = shell.webView
        guard web.superview !== host.view else { return }
        web.removeFromSuperview()
        web.frame = host.view.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.view.addSubview(web)
    }
}
