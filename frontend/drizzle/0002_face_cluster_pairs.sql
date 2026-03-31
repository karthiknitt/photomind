CREATE TABLE `face_cluster_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id_a` text NOT NULL,
	`cluster_id_b` text NOT NULL,
	`is_same` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_cluster_pair` ON `face_cluster_pairs` (`cluster_id_a`, `cluster_id_b`);
--> statement-breakpoint
CREATE INDEX `idx_fcp_cluster_a` ON `face_cluster_pairs` (`cluster_id_a`);
--> statement-breakpoint
CREATE INDEX `idx_fcp_cluster_b` ON `face_cluster_pairs` (`cluster_id_b`);
