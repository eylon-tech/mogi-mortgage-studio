import {sqliteTable,text,index} from 'drizzle-orm/sqlite-core';
export const documents=sqliteTable('documents',{id:text('id').primaryKey(),owner:text('owner').notNull(),kind:text('kind').notNull(),name:text('name').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull()},t=>[index('idx_documents_owner_kind_created').on(t.owner,t.kind,t.createdAt)]);
