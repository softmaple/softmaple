# Database CRUD Abstraction

This module provides a type-safe CRUD abstraction layer for all database tables with both client-side and server-side support.

## Features

- **Type-safe operations** - Full TypeScript support with Prisma-generated types
- **Server-only protection** - Uses `import 'server-only'` to prevent client-side usage of server functions
- **Modular architecture** - Separated into focused, maintainable functions
- **Consistent API** - Same interface across all database tables
- **Error handling** - Comprehensive error logging and Supabase response format

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

## Implementation Details

### Server-Only Protection

The server CRUD implementation uses `import 'server-only'` to prevent accidental import into client components:

```typescript
// apps/web/utils/crud/server.ts
import "server-only";
```

This provides build-time protection against server/client boundary violations, following Next.js App Router best practices.

### Modular Function Architecture

Server CRUD operations are implemented as separate factory functions for better maintainability:

- `createGetAllFunction` - Handles getAll operations with filtering/pagination
- `createGetByIdFunction` - Handles single record retrieval by ID
- `createGetByFunction` - Handles filtered queries with options
- `createGetOneByFunction` - Handles single record by filter
- `createCreateFunction` - Handles record creation
- `createUpdateFunction` - Handles record updates
- `createUpsertFunction` - Handles upsert operations
- `createDeleteFunction` - Handles record deletion

### Type Safety

All operations are fully typed using Prisma-generated types:

```typescript
// Automatic type inference based on table name
const { data: documents } = await serverCrud.documents().getAll();
// documents is typed as Document[] | null

const { data: newDoc } = await serverCrud.documents().create({
  title: "New Document", // TypeScript enforces required fields
  workspace_id: 1,
  author_id: "user-id",
  slug: "new-document",
});
// newDoc is typed as Document | null
```

### Error Handling

All CRUD operations include comprehensive error handling:

```typescript
const { data, error } = await serverCrud.documents().getById("invalid-id");
if (error) {
  console.error("Database operation failed:", error);
  // Handle error appropriately
}
```

## Migration from Direct Supabase Usage

If you're migrating from direct Supabase calls:

```typescript
// Before (direct Supabase)
const supabase = await createClient();
const { data, error } = await supabase
  .from("documents")
  .select("*")
  .eq("workspace_id", workspaceId);

// After (CRUD abstraction)
const { data, error } = await serverCrud.documents().getBy({
  workspace_id: workspaceId
});
```

The CRUD abstraction provides the same functionality with better type safety and consistency.
