-- Приёмы пищи дня (day_meals): название и порядок в дне; запись принадлежит приёму.
-- Прежние записи: один приём на (владелец, местный день, вид приёма), название —
-- по виду (breakfast → «Завтрак»…), порядок — по времени первой записи. Местный
-- день — в часовом поясе профиля (неизвестный Postgres пояс или нет профиля —
-- Москва). Порядок приёмов пользователя (meal_plan) и показ времени — в профиле.
-- when в журнале — как у прежней 0006 (эта миграция заменила 0005 + 0006): базы,
-- где они уже применены, считают её применённой, их схема та же.
CREATE TABLE "day_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_meals" ADD CONSTRAINT "day_meals_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_meals_owner_date_idx" ON "day_meals" USING btree ("owner_id","date");--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "meal_id" uuid;--> statement-breakpoint
INSERT INTO "day_meals" ("owner_id", "date", "name", "position")
SELECT g."owner_id", g."date", g."name",
	row_number() OVER (PARTITION BY g."owner_id", g."date" ORDER BY g."first_at", g."name")
FROM (
	SELECT e."owner_id", (e."eaten_at" AT TIME ZONE t."tz")::date AS "date",
		CASE e."meal"
			WHEN 'breakfast' THEN 'Завтрак'
			WHEN 'lunch' THEN 'Обед'
			WHEN 'snack' THEN 'Перекус'
			WHEN 'dinner' THEN 'Ужин'
		END AS "name",
		min(e."eaten_at") AS "first_at"
	FROM "entries" e
	JOIN (
		SELECT u."id" AS "owner_id", coalesce(z."name", 'Europe/Moscow') AS "tz"
		FROM "user" u
		LEFT JOIN "profiles" p ON p."owner_id" = u."id"
		LEFT JOIN pg_timezone_names z ON lower(z."name") = lower(p."timezone")
	) t ON t."owner_id" = e."owner_id"
	GROUP BY 1, 2, 3
) g;--> statement-breakpoint
UPDATE "entries" e SET "meal_id" = m."id"
FROM "day_meals" m, (
	SELECT u."id" AS "owner_id", coalesce(z."name", 'Europe/Moscow') AS "tz"
	FROM "user" u
	LEFT JOIN "profiles" p ON p."owner_id" = u."id"
	LEFT JOIN pg_timezone_names z ON lower(z."name") = lower(p."timezone")
) t
WHERE t."owner_id" = e."owner_id"
	AND m."owner_id" = e."owner_id"
	AND m."name" = CASE e."meal"
		WHEN 'breakfast' THEN 'Завтрак'
		WHEN 'lunch' THEN 'Обед'
		WHEN 'snack' THEN 'Перекус'
		WHEN 'dinner' THEN 'Ужин'
	END
	AND m."date" = (e."eaten_at" AT TIME ZONE t."tz")::date;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "meal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_meal_id_day_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."day_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_meal_idx" ON "entries" USING btree ("meal_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "meal_plan" text[] DEFAULT '{Завтрак,Обед,Перекус,Ужин}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_meal_times" boolean DEFAULT false NOT NULL;
