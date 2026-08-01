ALTER TABLE `push_audience` ADD `session_token_hash` text;--> statement-breakpoint
CREATE INDEX `push_audience_session_idx` ON `push_audience` (`session_token_hash`);