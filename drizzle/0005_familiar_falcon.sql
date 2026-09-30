-- Свободное название приёма пищи. Прежние записи получают название по виду приёма.
ALTER TABLE "entries" ADD COLUMN "meal_name" text;--> statement-breakpoint
UPDATE "entries" SET "meal_name" = CASE "meal"
	WHEN 'breakfast' THEN 'Завтрак'
	WHEN 'lunch' THEN 'Обед'
	WHEN 'snack' THEN 'Перекус'
	WHEN 'dinner' THEN 'Ужин'
END;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "meal_name" SET NOT NULL;
