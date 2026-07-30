CREATE TABLE `join_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`items` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_id` text,
	`bumped_at` integer,
	`handoff` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`email` text,
	`password_hash` text,
	`device_id` text,
	`role` text DEFAULT 'bartender' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`claim_hash` text,
	`claim_expires_at` integer,
	`joined_via` text DEFAULT 'request' NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_email_unique` ON `staff` (`email`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`device_id` text NOT NULL,
	`role` text NOT NULL,
	`subscription` text NOT NULL,
	`endpoint` text NOT NULL,
	`transport` text DEFAULT 'webpush' NOT NULL,
	`platform` text DEFAULT 'web' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `endpoint`, `role`)
);
