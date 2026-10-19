import CoreLocation
import PDFKit
import UIKit

/// Taptic feedback for the web app's moments: the shutter, a finished reading.
enum Haptics {
    static func play(_ style: String?) {
        switch style {
        case "selection":
            UISelectionFeedbackGenerator().selectionChanged()
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning":
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "heavy":
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

/// One-shot positions for the clinician finder, through Core Location.
///
/// Failures use the web Geolocation API's codes, since that is the interface
/// the page sees (the bridge in WebShell stands in for navigator.geolocation).
final class Locator: NSObject, CLLocationManagerDelegate {
    enum Failure: Int, Error {
        case denied = 1, unavailable = 2
    }

    private let manager = CLLocationManager()
    private var waiting: [(Result<CLLocation, Failure>) -> Void] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func locate(_ completion: @escaping (Result<CLLocation, Failure>) -> Void) {
        waiting.append(completion)
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()   // continues in the authorization callback
        case .denied, .restricted:
            finish(.failure(.denied))
        default:
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !waiting.isEmpty else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            break
        case .denied, .restricted:
            finish(.failure(.denied))
        default:
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let location = locations.last { finish(.success(location)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        finish(.failure(denied ? .denied : .unavailable))
    }

    private func finish(_ result: Result<CLLocation, Failure>) {
        let callbacks = waiting
        waiting.removeAll()
        callbacks.forEach { $0(result) }
    }
}

/// Lays a print formatter out on paper and returns the pages as a PDF.
///
/// US Letter where the region measures in inches, A4 everywhere else, with the
/// margins styles/print.css asks for (14mm top and bottom, 12mm at the sides).
enum PDFRenderer {
    static func render(_ formatter: UIPrintFormatter) -> Data {
        let usesLetter = Locale.current.measurementSystem == .us
        let paper = usesLetter
            ? CGRect(x: 0, y: 0, width: 612, height: 792)
            : CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        let mm: CGFloat = 72 / 25.4
        let renderer = PaperRenderer(paper: paper, insets: UIEdgeInsets(top: 14 * mm, left: 12 * mm, bottom: 14 * mm, right: 12 * mm))
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)

        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, paper, [kCGPDFContextCreator as String: "Versine"])
        /* The web view paginates for the paper only once asked to prepare, and
           the count read before that can be a page short, which loses the end
           of the document. So prepare generously, then read the count. */
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for page in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: page, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return trimmingBlankPages(data as Data)
    }

    /// The page shell (WebShell.exportPDF) pads the document so WebKit's page
    /// count has room; the padding comes out as blank pages at the end.
    private static func trimmingBlankPages(_ data: Data) -> Data {
        guard let document = PDFDocument(data: data) else { return data }
        while document.pageCount > 1, let last = document.page(at: document.pageCount - 1), isBlank(last) {
            document.removePage(at: document.pageCount - 1)
        }
        return document.dataRepresentation() ?? data
    }

    /// Blank means nothing drawn: every pixel of a small rendering is white.
    private static func isBlank(_ page: PDFPage) -> Bool {
        let width = 102, height = 132
        guard let image = page.thumbnail(of: CGSize(width: width, height: height), for: .mediaBox).cgImage,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return false }
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else { return false }
        for offset in stride(from: 0, to: width * height * 4, by: 4)
        where pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248 {
            return false
        }
        return true
    }

    /// UIPrintPageRenderer's paper and printable area are read-only; a print
    /// job normally supplies them.
    private final class PaperRenderer: UIPrintPageRenderer {
        private let paper: CGRect
        private let insets: UIEdgeInsets

        init(paper: CGRect, insets: UIEdgeInsets) {
            self.paper = paper
            self.insets = insets
            super.init()
        }

        override var paperRect: CGRect { paper }
        override var printableRect: CGRect { paper.inset(by: insets) }
    }
}
