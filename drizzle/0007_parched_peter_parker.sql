CREATE TABLE `notification_control` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'shadow' NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `notification_daily_aggregate` (
	`event_id` text NOT NULL,
	`day` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`targeted` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`permanent_failures` integer DEFAULT 0 NOT NULL,
	`expired` integer DEFAULT 0 NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`displayed` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`acceptance_latency_ms` integer DEFAULT 0 NOT NULL,
	`receipt_latency_ms` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`event_id`, `day`, `platform`, `kind`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`endpoint_id` text,
	`endpoint_hash` text NOT NULL,
	`subscription_ciphertext` text,
	`platform` text NOT NULL,
	`delivery_mode` text NOT NULL,
	`status` text NOT NULL,
	`receipt_token_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`provider_status` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`first_attempt_at` integer,
	`accepted_at` integer,
	`received_at` integer,
	`displayed_at` integer,
	`clicked_at` integer,
	`terminal_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `notification_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`endpoint_id`) REFERENCES `push_endpoint`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_receipt_unique` ON `notification_delivery` (`receipt_token_hash`);--> statement-breakpoint
CREATE INDEX `notification_delivery_claim_idx` ON `notification_delivery` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `notification_delivery_message_idx` ON `notification_delivery` (`message_id`);--> statement-breakpoint
CREATE INDEX `notification_delivery_endpoint_idx` ON `notification_delivery` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX `notification_delivery_created_idx` ON `notification_delivery` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_message` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`kind` text NOT NULL,
	`entity_hash` text NOT NULL,
	`title` text,
	`body` text,
	`url` text NOT NULL,
	`tag` text NOT NULL,
	`topic` text NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`urgency` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redacted_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_message_event_idx` ON `notification_message` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_message_expiry_idx` ON `notification_message` (`expires_at`);--> statement-breakpoint
CREATE TABLE `push_audience` (
	`endpoint_id` text NOT NULL,
	`audience_key` text NOT NULL,
	`role` text NOT NULL,
	`event_id` text,
	`staff_id` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`endpoint_id`, `audience_key`),
	FOREIGN KEY (`endpoint_id`) REFERENCES `push_endpoint`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_audience_event_role_idx` ON `push_audience` (`event_id`,`role`,`expires_at`);--> statement-breakpoint
CREATE INDEX `push_audience_staff_idx` ON `push_audience` (`staff_id`);--> statement-breakpoint
CREATE TABLE `push_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`subscription_ciphertext` text NOT NULL,
	`transport` text DEFAULT 'webpush' NOT NULL,
	`platform` text DEFAULT 'web' NOT NULL,
	`management_token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_accepted_at` integer,
	`last_failure_at` integer,
	`invalidated_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_endpoint_hash_unique` ON `push_endpoint` (`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `push_endpoint_device_idx` ON `push_endpoint` (`device_id`);--> statement-breakpoint
CREATE INDEX `push_endpoint_seen_idx` ON `push_endpoint` (`last_seen_at`);