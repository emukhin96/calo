// Схема приложения — docs/ARCHITECTURE.md §4.
// Все пользовательские данные несут owner_id: приложение с первого дня
// многопользовательское, даже пока вход открыт одному человеку.
import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { NutrientVector } from "@/domain/nutrients";
import { user } from "./auth";

const ownerId = () =>
  text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const nutrients = (name: string) => jsonb(name).$type<NutrientVector>().notNull();

export const foodSource = pgEnum("food_source", ["usda", "off", "manual", "ai_estimate"]);
export const recipeKind = pgEnum("recipe_kind", ["template", "composite"]);
export const meal = pgEnum("meal", ["breakfast", "lunch", "dinner", "snack"]);
export const inputMethod = pgEnum("input_method", ["template", "recipe", "product", "photo"]);
export const sex = pgEnum("sex", ["female", "male"]);
export const activity = pgEnum("activity", ["sedentary", "light", "moderate", "active", "very_active"]);
export const goalKind = pgEnum("goal_kind", ["lose", "maintain", "gain"]);
export const weightSource = pgEnum("weight_source", ["manual", "apple_health"]);

/** Справочник продуктов: общий (owner_id = null) и личный. */
export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    brand: text("brand"),
    source: foodSource("source").notNull(),
    sourceRef: text("source_ref"),
    nutrientsPer100g: nutrients("nutrients_per_100g"),
    defaultPortionG: real("default_portion_g"),
    portionLabel: text("portion_label"),
    /** Нормализованный текст для поиска (src/domain/search.ts), пишется вместе с записью. */
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("foods_owner_idx").on(t.ownerId),
    uniqueIndex("foods_source_ref_idx").on(t.source, t.sourceRef),
    index("foods_search_trgm_idx").using("gin", sql`${t.searchText} gin_trgm_ops`),
  ],
);

/** Мои блюда: шаблоны с фиксированным КБЖУ и составные рецепты. */
export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    kind: recipeKind("kind").notNull(),
    totalWeightG: real("total_weight_g"),
    nutrientsPer100g: nutrients("nutrients_per_100g"),
    defaultPortionG: real("default_portion_g"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("recipes_owner_idx").on(t.ownerId)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    foodId: uuid("food_id")
      .notNull()
      .references(() => foods.id),
    grams: real("grams").notNull(),
    rawText: text("raw_text"),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId)],
);

/** Дневник. nutrients — снимок на момент записи: правка продукта не меняет историю. */
export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    eatenAt: timestamp("eaten_at", { withTimezone: true }).notNull(),
    meal: meal("meal").notNull(),
    inputMethod: inputMethod("input_method").notNull(),
    title: text("title").notNull(),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    grams: real("grams").notNull(),
    nutrients: nutrients("nutrients"),
    photoPath: text("photo_path"),
    aiConfidence: real("ai_confidence"),
    healthkitUuid: text("healthkit_uuid"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("entries_owner_eaten_idx").on(t.ownerId, t.eatenAt)],
);

export const profiles = pgTable("profiles", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  sex: sex("sex").notNull(),
  birthYear: smallint("birth_year").notNull(),
  heightCm: real("height_cm").notNull(),
  activity: activity("activity").notNull(),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** История целей: смена цели — новая строка, текущая — последняя по valid_from. */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    kind: goalKind("kind").notNull(),
    rateKgPerWeek: real("rate_kg_per_week"),
    targetWeightKg: real("target_weight_kg"),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("goals_owner_valid_idx").on(t.ownerId, t.validFrom)],
);

export const weightLog = pgTable(
  "weight_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    weightKg: doublePrecision("weight_kg").notNull(),
    source: weightSource("source").notNull().default("manual"),
    externalId: text("external_id"),
  },
  (t) => [index("weight_log_owner_measured_idx").on(t.ownerId, t.measuredAt)],
);

/** Ручная правка любой нормы (ключ — ключ NutrientVector). */
export const normsOverride = pgTable(
  "norms_override",
  {
    ownerId: ownerId(),
    nutrient: text("nutrient").notNull(),
    value: doublePrecision("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.nutrient] })],
);

/** Кэш недельного разбора со снимком норм, действовавших на той неделе. */
export const weeklyReports = pgTable(
  "weekly_reports",
  {
    ownerId: ownerId(),
    weekStart: date("week_start").notNull(),
    norms: jsonb("norms").notNull(),
    payload: jsonb("payload").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.weekStart] })],
);

/** Счётчик запросов к ИИ на пользователя в день — для лимитов. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    ownerId: ownerId(),
    day: date("day").notNull(),
    requests: integer("requests").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.day] })],
);

/** Служебные ключ-значение: версия загруженного справочника продуктов и т. п. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Подписки Web Push (по одной на браузер/устройство). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    /** Понедельник недели, о разборе которой уже напомнили. */
    lastWeekNotified: date("last_week_notified"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_owner_idx").on(t.ownerId)],
);
