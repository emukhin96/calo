// Нативный мост Calo: Apple Health и виджет. JS-сторона — src/lib/native.ts.
import Capacitor
import Foundation
import HealthKit
import WidgetKit

@objc(CaloNativePlugin)
public class CaloNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CaloNativePlugin"
    public let jsName = "CaloNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "healthAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestHealth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFood", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFood", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "latestWeight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    /// Наши ключи нутриентов (src/domain/nutrients.ts) → тип HealthKit и единица.
    /// Омега-3 в HealthKit нет — не пишем.
    private static let nutrientTypes: [String: (HKQuantityTypeIdentifier, HKUnit)] = [
        "kcal": (.dietaryEnergyConsumed, .kilocalorie()),
        "protein": (.dietaryProtein, .gram()),
        "fat": (.dietaryFatTotal, .gram()),
        "carbs": (.dietaryCarbohydrates, .gram()),
        "fiber": (.dietaryFiber, .gram()),
        "sugar": (.dietarySugar, .gram()),
        "vitA": (.dietaryVitaminA, .gramUnit(with: .micro)),
        "vitC": (.dietaryVitaminC, .gramUnit(with: .milli)),
        "vitD": (.dietaryVitaminD, .gramUnit(with: .micro)),
        "vitE": (.dietaryVitaminE, .gramUnit(with: .milli)),
        "vitK": (.dietaryVitaminK, .gramUnit(with: .micro)),
        "b1": (.dietaryThiamin, .gramUnit(with: .milli)),
        "b2": (.dietaryRiboflavin, .gramUnit(with: .milli)),
        "b6": (.dietaryVitaminB6, .gramUnit(with: .milli)),
        "b9": (.dietaryFolate, .gramUnit(with: .micro)),
        "b12": (.dietaryVitaminB12, .gramUnit(with: .micro)),
        "calcium": (.dietaryCalcium, .gramUnit(with: .milli)),
        "iron": (.dietaryIron, .gramUnit(with: .milli)),
        "magnesium": (.dietaryMagnesium, .gramUnit(with: .milli)),
        "potassium": (.dietaryPotassium, .gramUnit(with: .milli)),
        "sodium": (.dietarySodium, .gramUnit(with: .milli)),
        "zinc": (.dietaryZinc, .gramUnit(with: .milli)),
        "selenium": (.dietarySelenium, .gramUnit(with: .micro)),
    ]

    private var writeTypes: Set<HKSampleType> {
        Set(Self.nutrientTypes.values.compactMap { HKQuantityType.quantityType(forIdentifier: $0.0) })
    }
    private var readTypes: Set<HKObjectType> {
        [HKQuantityType.quantityType(forIdentifier: .bodyMass)!]
    }

    @objc func healthAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestHealth(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { return call.resolve(["granted": false]) }
        store.requestAuthorization(toShare: writeTypes, read: readTypes) { ok, error in
            if let error { return call.reject(error.localizedDescription) }
            call.resolve(["granted": ok])
        }
    }

    /// Запись дневника → «Питание» в Здоровье. id записи — ключ: правка перезаписывает.
    /// { id, title, eatenAt (ISO), nutrients: { kcal, protein, … } }
    @objc func saveFood(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let at = call.getString("eatenAt").flatMap(Self.parseDate),
              let nutrients = call.getObject("nutrients")
        else { return call.reject("id, eatenAt, nutrients обязательны") }
        let title = call.getString("title") ?? "Calo"
        let meta: [String: Any] = [HKMetadataKeyExternalUUID: id, HKMetadataKeyFoodType: title]

        var samples = Set<HKSample>()
        for (key, value) in nutrients {
            guard let (typeId, unit) = Self.nutrientTypes[key],
                  let type = HKQuantityType.quantityType(forIdentifier: typeId),
                  let amount = (value as? NSNumber)?.doubleValue, amount > 0,
                  store.authorizationStatus(for: type) == .sharingAuthorized
            else { continue }
            samples.insert(HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: amount), start: at, end: at, metadata: meta))
        }
        guard !samples.isEmpty else { return call.resolve(["saved": 0]) }

        removeSamples(externalId: id) { [store] in
            let food = HKCorrelation(type: HKCorrelationType.correlationType(forIdentifier: .food)!, start: at, end: at, objects: samples, metadata: meta)
            store.save(food) { ok, error in
                if let error { return call.reject(error.localizedDescription) }
                call.resolve(["saved": ok ? samples.count : 0])
            }
        }
    }

    @objc func deleteFood(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("id обязателен") }
        removeSamples(externalId: id) { call.resolve() }
    }

    /// Удалить наши образцы этой записи (по HKMetadataKeyExternalUUID) по всем типам.
    private func removeSamples(externalId: String, then done: @escaping () -> Void) {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [externalId])
        let types = writeTypes.filter { store.authorizationStatus(for: $0) == .sharingAuthorized }
        let group = DispatchGroup()
        for type in types {
            group.enter()
            store.deleteObjects(of: type, predicate: predicate) { _, _, _ in group.leave() }
        }
        group.notify(queue: .main, execute: done)
    }

    /// Последнее взвешивание: { kg, measuredAt, uuid } или null.
    @objc func latestWeight(_ call: CAPPluginCall) {
        let type = HKQuantityType.quantityType(forIdentifier: .bodyMass)!
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: [sort]) { _, samples, error in
            if let error { return call.reject(error.localizedDescription) }
            guard let s = samples?.first as? HKQuantitySample else { return call.resolve(["weight": NSNull()]) }
            call.resolve(["weight": [
                "kg": s.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                "measuredAt": ISO8601DateFormatter().string(from: s.endDate),
                "uuid": s.uuid.uuidString,
            ]])
        }
        store.execute(query)
    }

    /// Данные для виджета в App Group: адрес, токен, сводка дня, блюда для «+».
    /// { baseURL, token, summary, dishes }
    @objc func setWidgetData(_ call: CAPPluginCall) {
        if let base = call.getString("baseURL"), let token = call.getString("token") {
            CaloShared.save(CaloShared.Config(baseURL: base, token: token), key: "config")
        }
        if let s = call.getObject("summary"), let data = try? JSONSerialization.data(withJSONObject: s),
           let summary = try? JSONDecoder().decode(CaloShared.Summary.self, from: data) {
            CaloShared.save(summary, key: "summary")
        }
        if let d = call.getArray("dishes"), let data = try? JSONSerialization.data(withJSONObject: d),
           let dishes = try? JSONDecoder().decode([CaloShared.Dish].self, from: data) {
            CaloShared.save(dishes, key: "dishes")
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    private static func parseDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}
