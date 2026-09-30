-- Свой список приёмов: скрытые названия (не предлагаются при добавлении еды,
-- но порядок дня задают) и новый порядок по умолчанию — Завтрак, Обед, Ужин,
-- Перекус («Перекус» — в любое время дня, новый встаёт в конец дня).
ALTER TABLE "profiles" ALTER COLUMN "meal_plan" SET DEFAULT '{Завтрак,Обед,Ужин,Перекус}'::text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "meal_plan_hidden" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Кто список не менял (прежний порядок по умолчанию) — новый порядок по умолчанию.
UPDATE "profiles" SET "meal_plan" = '{Завтрак,Обед,Ужин,Перекус}'::text[] WHERE "meal_plan" = '{Завтрак,Обед,Перекус,Ужин}'::text[];
