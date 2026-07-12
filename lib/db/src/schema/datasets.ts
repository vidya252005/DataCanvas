import { pgTable, text, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const datasetsTable = pgTable("datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  originalName: text("original_name").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  columnCount: integer("column_count").notNull().default(0),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  fileType: text("file_type").notNull(),
  storagePath: text("storage_path").notNull(),
  columnsJson: text("columns_json").notNull().default("[]"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  memorySizeMb: real("memory_size_mb").notNull().default(0),
});

export const insertDatasetSchema = createInsertSchema(datasetsTable).omit({ uploadedAt: true });
export type InsertDataset = z.infer<typeof insertDatasetSchema>;
export type Dataset = typeof datasetsTable.$inferSelect;
