import Capacitor
import UIKit

/// WebView Capacitor + регистрация своего плагина CaloNative (HealthKit, виджет).
class CaloViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CaloNativePlugin())
    }
}
