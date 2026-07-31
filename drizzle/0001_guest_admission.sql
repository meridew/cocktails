CREATE TABLE `event_guest` (
	`event_id` text NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`admitted_at` integer,
	PRIMARY KEY(`event_id`, `device_id`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
