-- Fractional-indexing keys only sort correctly bytewise: make SQL comparison/ordering match the
-- JS code-unit comparison (comparePositions) regardless of the database's locale.
ALTER TABLE "columns" ALTER COLUMN "position" TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "position" TYPE text COLLATE "C";
