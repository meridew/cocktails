CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`host_user_id` text,
	`name` text NOT NULL,
	`starts_at` integer,
	`status` text DEFAULT 'live' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`event_id` text NOT NULL,
	`ingredient` text NOT NULL,
	`in_stock` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`event_id`, `ingredient`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `event_id` text NOT NULL REFERENCES event(id);--> statement-breakpoint
ALTER TABLE `staff` ADD `event_id` text NOT NULL REFERENCES event(id);--> statement-breakpoint
ALTER TABLE `staff` ADD `user_id` text REFERENCES user(id);