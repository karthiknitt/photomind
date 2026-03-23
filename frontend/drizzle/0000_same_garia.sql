CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text,
	`action` text NOT NULL,
	`detail` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date_start` integer,
	`date_end` integer,
	`cover_photo_id` text,
	FOREIGN KEY (`cover_photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `face_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`photo_count` integer DEFAULT 0,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `faces` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`cluster_id` text,
	`embedding_id` text,
	`bbox_x` integer,
	`bbox_y` integer,
	`bbox_w` integer,
	`bbox_h` integer,
	`det_score` real,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cluster_id`) REFERENCES `face_clusters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `photo_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`tag` text NOT NULL,
	`source` text DEFAULT 'clip' NOT NULL,
	`confidence` real,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`source_remote` text NOT NULL,
	`source_path` text NOT NULL,
	`library_path` text,
	`filename_final` text,
	`date_taken` integer,
	`date_original_str` text,
	`gps_lat` real,
	`gps_lon` real,
	`city` text,
	`state` text,
	`country` text,
	`camera_make` text,
	`camera_model` text,
	`software` text,
	`width` integer,
	`height` integer,
	`file_size` integer,
	`phash` text,
	`is_meme` integer DEFAULT false,
	`meme_reason` text,
	`clip_indexed` integer DEFAULT false,
	`face_count` integer DEFAULT 0,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`error_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_name` text NOT NULL,
	`display_name` text NOT NULL,
	`scan_path` text NOT NULL,
	`last_scanned_at` integer,
	`enabled` integer DEFAULT true
);
