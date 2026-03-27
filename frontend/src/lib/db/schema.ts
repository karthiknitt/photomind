import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ─── photos ──────────────────────────────────────────────────────────────────

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(), // UUID
  sourceRemote: text("source_remote").notNull(),
  sourcePath: text("source_path").notNull(),
  libraryPath: text("library_path"),
  filenameFinal: text("filename_final"),
  dateTaken: integer("date_taken"), // Unix timestamp UTC
  dateOriginalStr: text("date_original_str"), // raw EXIF string
  gpsLat: real("gps_lat"),
  gpsLon: real("gps_lon"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  cameraMake: text("camera_make"),
  cameraModel: text("camera_model"),
  software: text("software"), // EXIF software (WhatsApp detection)
  width: integer("width"),
  height: integer("height"),
  fileSize: integer("file_size"), // bytes
  phash: text("phash"), // perceptual hash for dedup (indexed)
  isMeme: integer("is_meme", { mode: "boolean" }).default(false),
  memeReason: text("meme_reason"), // CSV of signal names
  clipIndexed: integer("clip_indexed", { mode: "boolean" }).default(false),
  faceCount: integer("face_count").default(0),
  status: text("status", {
    enum: ["QUEUED", "PROCESSING", "DONE", "SKIPPED", "ERROR"],
  })
    .notNull()
    .default("QUEUED"),
  errorDetail: text("error_detail"),
  createdAt: integer("created_at").notNull(), // Unix timestamp
  updatedAt: integer("updated_at").notNull(), // Unix timestamp
});

// ─── faces ────────────────────────────────────────────────────────────────────

export const faces = sqliteTable("faces", {
  id: text("id").primaryKey(),
  photoId: text("photo_id")
    .notNull()
    .references(() => photos.id),
  clusterId: text("cluster_id").references(() => faceClusters.id),
  embeddingId: text("embedding_id"), // ChromaDB document ID
  bboxX: integer("bbox_x"),
  bboxY: integer("bbox_y"),
  bboxW: integer("bbox_w"),
  bboxH: integer("bbox_h"),
  detScore: real("det_score"), // InsightFace confidence 0–1
});

// ─── face_clusters ────────────────────────────────────────────────────────────

export const faceClusters = sqliteTable("face_clusters", {
  id: text("id").primaryKey(),
  label: text("label"), // human-given name (nullable)
  photoCount: integer("photo_count").default(0),
  createdAt: integer("created_at").notNull(),
});

// ─── photo_tags ───────────────────────────────────────────────────────────────

export const photoTags = sqliteTable("photo_tags", {
  id: text("id").primaryKey(),
  photoId: text("photo_id")
    .notNull()
    .references(() => photos.id),
  tag: text("tag").notNull(),
  source: text("source", { enum: ["clip", "manual"] })
    .notNull()
    .default("clip"),
  confidence: real("confidence"),
});

// ─── events ───────────────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dateStart: integer("date_start"),
  dateEnd: integer("date_end"),
  coverPhotoId: text("cover_photo_id").references(() => photos.id),
});

// ─── action_log ───────────────────────────────────────────────────────────────

export const actionLog = sqliteTable("action_log", {
  id: text("id").primaryKey(),
  photoId: text("photo_id"), // nullable — some actions are source-level
  action: text("action", {
    enum: [
      "COPIED",
      "SKIPPED_DUPLICATE",
      "SKIPPED_MEME",
      "SKIPPED_ERROR",
      "INDEXED",
      "FACE_DETECTED",
      "CLUSTER_UPDATED",
    ],
  }).notNull(),
  detail: text("detail"), // JSON string or plain message
  timestamp: integer("timestamp").notNull(), // Unix timestamp
});

// ─── sources ──────────────────────────────────────────────────────────────────

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  remoteName: text("remote_name").notNull(), // rclone remote identifier
  displayName: text("display_name").notNull(),
  scanPath: text("scan_path").notNull(), // root path on remote
  lastScannedAt: integer("last_scanned_at"), // nullable
  enabled: integer("enabled", { mode: "boolean" }).default(true),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type Face = typeof faces.$inferSelect;
export type NewFace = typeof faces.$inferInsert;
export type FaceCluster = typeof faceClusters.$inferSelect;
export type NewFaceCluster = typeof faceClusters.$inferInsert;
export type PhotoTag = typeof photoTags.$inferSelect;
export type NewPhotoTag = typeof photoTags.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type ActionLog = typeof actionLog.$inferSelect;
export type NewActionLog = typeof actionLog.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
