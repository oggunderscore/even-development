import CoreLocation
import Foundation

final class LocationManager: NSObject, CLLocationManagerDelegate {
    static let shared = LocationManager()

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter  = kCLDistanceFilterNone
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestAlwaysAuthorization()
        default:
            manager.startUpdatingLocation()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined {
            manager.startUpdatingLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        BridgeState.shared.updateGPS(
            speed:    loc.speed,
            heading:  loc.course >= 0 ? loc.course : nil,
            lat:      loc.coordinate.latitude,
            lng:      loc.coordinate.longitude,
            accuracy: loc.horizontalAccuracy > 0 ? loc.horizontalAccuracy : nil
        )
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Keep last known values — transient failures are normal outdoors
    }
}
