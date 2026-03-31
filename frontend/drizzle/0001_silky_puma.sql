CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`local_path` text NOT NULL,
	`label` text,
	`total_count` integer,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
