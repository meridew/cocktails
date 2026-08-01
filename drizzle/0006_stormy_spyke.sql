CREATE TABLE `recipe_measure_override` (
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`ingredient` text NOT NULL,
	`volume_ml` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`, `ingredient`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `stock` ADD `abv_override` real;