CREATE TABLE `payslip_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_file` text NOT NULL,
	`month` text NOT NULL,
	`salary_cents` integer DEFAULT 0 NOT NULL,
	`bonus_cents` integer DEFAULT 0 NOT NULL,
	`on_call_cents` integer DEFAULT 0 NOT NULL,
	`reimbursements_cents` integer DEFAULT 0 NOT NULL,
	`non_taxable_adj_cents` integer DEFAULT 0 NOT NULL,
	`misc_deductions_cents` integer DEFAULT 0 NOT NULL,
	`pension_ee_cents` integer DEFAULT 0 NOT NULL,
	`avc_cents` integer DEFAULT 0 NOT NULL,
	`pension_er_cents` integer DEFAULT 0 NOT NULL,
	`paye_cents` integer DEFAULT 0 NOT NULL,
	`prsi_ee_cents` integer DEFAULT 0 NOT NULL,
	`usc_cents` integer DEFAULT 0 NOT NULL,
	`pension_ee_ytd_cents` integer DEFAULT 0 NOT NULL,
	`avc_ytd_cents` integer DEFAULT 0 NOT NULL,
	`pension_er_ytd_cents` integer DEFAULT 0 NOT NULL,
	`stated_net_cents` integer,
	`gross_cents` integer NOT NULL,
	`tax_total_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`net_reconciled` integer NOT NULL,
	`imported_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslip_runs_owner_file_idx` ON `payslip_runs` (`user_id`,`source_file`);--> statement-breakpoint
CREATE TABLE `source_owners` (
	`source` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
