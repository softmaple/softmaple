# Database CRUD Abstraction

This module provides a type-safe CRUD abstraction layer for all database tables with both client-side and server-side support.

## Usage

### Server-side (in server actions)

```typescript
"use server";

import { serverCrud } from "@/utils/crud";

// Get all documents
const { data: documents, error } = await serverCrud.documents().getAll();

// Get document by ID
const { data: document, error } = await serverCrud.documents().getById("doc-id");

// Create a new document
const { data: newDoc, error } = await serverCrud.documents().create({
  title: "New Document",
  workspace_id: 1,
  author_id: "user-id",
  slug: "new-document",
});

// Update a document
const { data: updatedDoc, error } = await serverCrud.documents().update("doc-id", {
  title: "Updated Title",
});
```

### Client-side (in components)

```typescript
"use client";

import { clientCrud } from "@/utils/crud";

// Get all workspaces
const { data: workspaces, error } = await clientCrud.workspaces().getAll();

// Get workspace by filter
const { data: workspace, error } = await clientCrud.workspaces().getOneBy({
  slug: "my-workspace",
});

// Create a new workspace
const { data: newWorkspace, error } = await clientCrud.workspaces().create({
  title: "New Workspace",
  slug: "new-workspace",
  owner_id: "user-id",
});
```

### Available Tables

- `users` - User management
- `workspaces` - Workspace management  
- `workspaceMembers` - Workspace membership
- `documents` - Document management
- `documentVersions` - Document version history

### Available Operations

- `getAll(options?)` - Get all records with optional filtering/pagination
- `getById(id)` - Get single record by ID
- `getBy(filter, options?)` - Get multiple records by filter
- `getOneBy(filter)` - Get single record by filter
- `create(data, options?)` - Create new record
- `update(id, data, options?)` - Update existing record
- `upsert(data, options?)` - Insert or update record
- `delete(id, options?)` - Delete record

All operations return `{ data, error }` format consistent with Supabase.
