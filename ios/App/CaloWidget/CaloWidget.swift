// Виджет Calo: калории и белок за сегодня + «+» для частых блюд (iOS 17).
import AppIntents
import SwiftUI
import WidgetKit

struct DayEntry: TimelineEntry {
    let date: Date
    let summary: CaloShared.Summary?
    let dishes: [CaloShared.Dish]
    let signedIn: Bool
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(
            date: .now,
            summary: .init(date: "", kcal: 1830, norm: 2450, protein: 96, proteinNorm: 130, fat: 64, carbs: 205, updatedAt: ""),
            dishes: [.init(id: "1", name: "Творог утром", grams: 180, kcal: 218)],
            signedIn: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : cached())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        Task {
            let summary = await CaloShared.fetchSummary()
            CaloShared.note("timeline: \(summary?.kcal ?? -1) ккал, блюд \(CaloShared.dishes.count)")
            let entry = DayEntry(date: .now, summary: summary, dishes: CaloShared.dishes, signedIn: CaloShared.config != nil)
            // Раз в 30 минут; после полуночи — сразу, чтобы начать новый день с нуля.
            let next = min(Date.now.addingTimeInterval(30 * 60), Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400)))
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func cached() -> DayEntry {
        DayEntry(date: .now, summary: CaloShared.summary, dishes: CaloShared.dishes, signedIn: CaloShared.config != nil)
    }
}

// MARK: — Интент кнопки «+»: записать блюдо без открытия приложения

struct AddDishIntent: AppIntent {
    static var title: LocalizedStringResource = "Добавить блюдо в Calo"
    static var openAppWhenRun = false

    @Parameter(title: "Блюдо") var dishId: String

    init() {}
    init(dishId: String) { self.dishId = dishId }

    func perform() async throws -> some IntentResult {
        CaloShared.note("нажато \(dishId)")
        guard let dish = CaloShared.dishes.first(where: { $0.id == dishId }) else {
            CaloShared.note("блюдо не найдено \(dishId)")
            return .result()
        }
        if await CaloShared.addDish(dish) {
            _ = await CaloShared.fetchSummary()
        }
        return .result()
    }
}

// MARK: — Вид

private let accent = Color(red: 0x24 / 255, green: 0x38 / 255, blue: 0xD6 / 255)
private let warn = Color(red: 0xF2 / 255, green: 0x6A / 255, blue: 0x1B / 255)

private func ratio(_ v: Int, _ norm: Int?) -> Double {
    guard let norm, norm > 0 else { return 0 }
    return min(1, Double(v) / Double(norm))
}

struct Ring: View {
    let summary: CaloShared.Summary
    var body: some View {
        let over = (summary.norm ?? .max) < summary.kcal
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 9)
            Circle()
                .trim(from: 0, to: ratio(summary.kcal, summary.norm))
                .stroke(over ? warn : accent, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(summary.kcal)").font(.system(size: 20, weight: .heavy, design: .rounded)).minimumScaleFactor(0.6)
                if let norm = summary.norm {
                    Text("из \(norm)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct CaloWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DayEntry

    var body: some View {
        if !entry.signedIn || entry.summary == nil {
            Text("Откройте Calo, чтобы подключить виджет").font(.footnote).multilineTextAlignment(.center)
        } else if let s = entry.summary {
            switch family {
            case .accessoryCircular:
                Gauge(value: ratio(s.kcal, s.norm)) { Text("ккал") } currentValueLabel: { Text("\(s.kcal)") }
                    .gaugeStyle(.accessoryCircular)
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text("\(s.kcal) ккал").font(.headline)
                    Text("белок \(s.protein) из \(s.proteinNorm ?? 0) г").font(.caption)
                }
            case .systemMedium:
                HStack(spacing: 14) {
                    Ring(summary: s).frame(width: 96, height: 96)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("белок \(s.protein) / \(s.proteinNorm ?? 0) г").font(.caption).foregroundStyle(.secondary)
                        ForEach(entry.dishes.prefix(2)) { dish in
                            Button(intent: AddDishIntent(dishId: dish.id)) {
                                HStack {
                                    Text(dish.name).lineLimit(1).font(.system(size: 13, weight: .semibold))
                                    Spacer(minLength: 4)
                                    Text("+").font(.system(size: 16, weight: .bold))
                                }
                            }
                            .buttonStyle(.bordered)
                            .tint(accent)
                        }
                        if entry.dishes.isEmpty {
                            Text("Сохраните блюда в Calo — здесь появятся кнопки «+»").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            default:
                VStack(spacing: 8) {
                    Ring(summary: s).frame(width: 92, height: 92)
                    Text("белок \(s.protein)/\(s.proteinNorm ?? 0) г").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct CaloWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CaloWidget", provider: Provider()) { entry in
            CaloWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "calo://today"))
        }
        .configurationDisplayName("Calo — сегодня")
        .description("Калории и белок за день, кнопки «+» для частых блюд.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct CaloWidgetBundle: WidgetBundle {
    var body: some Widget { CaloWidget() }
}
