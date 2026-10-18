import CoreLocation
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
