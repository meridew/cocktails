CREATE TABLE `event_sound` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`cue` text NOT NULL,
	`audio` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
