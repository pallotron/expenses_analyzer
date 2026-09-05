CREATE TABLE `bank_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text DEFAULT 'truelayer' NOT NULL,
	`provider_name` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`token_expires_at` integer,
	`linked_by` integer NOT NULL,
	`last_sync` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_connection_id_unique` ON `bank_connections` (`connection_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`spending_type` text,
	`is_archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`filename` text,
	`rows_inserted` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL,
	`imported_by` integer NOT NULL,
	`imported_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `merchant_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`merchant_id` integer NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_aliases_pattern_unique` ON `merchant_aliases` (`pattern`);--> statement-breakpoint
CREATE INDEX `merchant_aliases_merchant_idx` ON `merchant_aliases` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`category_id` integer,
	`category_suggested` integer DEFAULT false NOT NULL,
	`category_set_by` integer,
	`category_set_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_canonical_name_unique` ON `merchants` (`canonical_name`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`month` text NOT NULL,
	`gross_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`tax_total_cents` integer NOT NULL,
	`pension_ee_cents` integer DEFAULT 0 NOT NULL,
	`avc_cents` integer DEFAULT 0 NOT NULL,
	`pension_er_cents` integer DEFAULT 0 NOT NULL,
	`bonus_cents` integer DEFAULT 0 NOT NULL,
	`on_call_cents` integer DEFAULT 0 NOT NULL,
	`source_files` text DEFAULT '[]' NOT NULL,
	`ytd_reconciled` integer,
	`net_reconciled` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_owner_month_idx` ON `payslips` (`user_id`,`month`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spending_type_budgets` (
	`spending_type` text PRIMARY KEY NOT NULL,
	`annual_budget_cents` integer
);
--> statement-breakpoint
CREATE TABLE `tag_exclusion_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_exclusion_patterns_pattern_unique` ON `tag_exclusion_patterns` (`pattern`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`tagged_by` integer,
	`tagged_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_tag_idx` ON `transaction_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` integer NOT NULL,
	`merchant_raw` text NOT NULL,
	`merchant_id` integer,
	`amount_cents` integer NOT NULL,
	`type` text DEFAULT 'expense' NOT NULL,
	`source` text DEFAULT 'Manual' NOT NULL,
	`category_override_id` integer,
	`external_id` text,
	`occurrence` integer DEFAULT 0 NOT NULL,
	`import_batch_id` integer,
	`deleted_at` integer,
	`deleted_by` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_override_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_external_id_idx` ON `transactions` (`external_id`) WHERE "transactions"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe_idx` ON `transactions` (`date`,`merchant_id`,`amount_cents`,`occurrence`) WHERE "transactions"."external_id" IS NULL AND "transactions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transactions_live_idx` ON `transactions` (`deleted_at`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`owner_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_owner_key_unique` ON `users` (`owner_key`);