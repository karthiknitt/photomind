CREATE TABLE `face_cluster_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id_a` text NOT NULL,
	`cluster_id_b` text NOT NULL,
	`is_same` integer NOT NULL,
	`created_at` integer NOT NULL
);
