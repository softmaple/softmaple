import type { Database } from "@/types/model";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Creates a mock Supabase client for E2E testing.
 * This ensures type safety and consistency across client and server mocks.
 */
export function createMockSupabaseClient(
  userData: User,
): SupabaseClient<Database> {
  const mockSession = {
    access_token: "test-token",
    refresh_token: "test-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: userData,
  };

  const mockWorkspaceData = [
    {
      id: "mock-id",
      slug: "test-workspace",
      name: "Test Workspace",
      title: "Test Workspace",
      description: "Mock workspace for testing",
      owner_id: userData.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const mockClient = {
    auth: {
      getUser: async () => ({
        data: { user: userData },
        error: null,
      }),
      getSession: async () => ({
        data: { session: mockSession },
        error: null,
      }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({
        data: { user: userData, session: mockSession },
        error: null,
      }),
      onAuthStateChange: (callback: any) => {
        // Immediately trigger with test user
        if (callback) {
          callback("SIGNED_IN", mockSession);
        }
        return {
          data: { subscription: { unsubscribe: () => {} } },
          error: null,
        };
      },
      // Additional auth methods for completeness
      signUp: async () => ({
        data: { user: userData, session: mockSession },
        error: null,
      }),
      signInWithOAuth: async () => ({
        data: { url: "http://mock-oauth-url", provider: "github" },
        error: null,
      }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      verifyOtp: async () => ({
        data: { user: userData, session: mockSession },
        error: null,
      }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async (attributes: any) => ({
        data: { user: { ...userData, ...attributes } },
        error: null,
      }),
      getSessionFromUrl: async () => ({
        data: { session: mockSession },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: mockSession },
        error: null,
      }),
      setSession: async () => ({ data: { session: mockSession }, error: null }),
      exchangeCodeForSession: async () => ({
        data: { session: mockSession },
        error: null,
      }),
      getUrlForProvider: () => ({
        data: { url: "http://mock-provider-url" },
        error: null,
      }),
    } as any, // Auth API has many methods, using 'as any' for the full interface

    from: (table: string) => {
      // Create a chainable query builder that mimics Supabase's API
      const createChainableQuery = (data: any[] = mockWorkspaceData): any => {
        const chainObj = {
          select: (columns?: string) => createChainableQuery(data),
          eq: (column: string, value: any) => {
            const filtered = data.filter((item: any) => item[column] === value);
            return createChainableQuery(filtered);
          },
          neq: (column: string, value: any) => {
            const filtered = data.filter((item: any) => item[column] !== value);
            return createChainableQuery(filtered);
          },
          match: (filter: any) => {
            const filtered = data.filter((item: any) => {
              return Object.keys(filter).every(
                (key) => item[key] === filter[key],
              );
            });
            return createChainableQuery(filtered);
          },
          in: (column: string, values: any[]) => {
            const filtered = data.filter((item: any) =>
              values.includes(item[column]),
            );
            return createChainableQuery(filtered);
          },
          order: (column: string, options?: { ascending?: boolean }) =>
            createChainableQuery(data),
          limit: (count: number) => createChainableQuery(data.slice(0, count)),
          range: (from: number, to: number) =>
            createChainableQuery(data.slice(from, to + 1)),
          maybeSingle: async () => ({
            data: data.length > 0 ? data[0] : null,
            error: null,
            count: null,
            status: 200,
            statusText: "OK",
          }),
          single: async () => ({
            data: data[0] || {},
            error: null,
            count: null,
            status: 200,
            statusText: "OK",
          }),
          // Support Promise-like interface
          then: async (resolve: any) =>
            resolve({
              data,
              error: null,
              count: data.length,
              status: 200,
              statusText: "OK",
            }),
          // Properties for direct access
          data,
          error: null,
          count: data.length,
        };
        return chainObj;
      };

      return {
        select: (columns?: string) => createChainableQuery(),
        insert: (values: any | any[]) => ({
          select: (columns?: string) => ({
            maybeSingle: async () => ({
              data: Array.isArray(values)
                ? { id: "mock-id", ...values[0] }
                : { id: "mock-id", ...values },
              error: null,
              count: null,
              status: 201,
              statusText: "Created",
            }),
            single: async () => ({
              data: Array.isArray(values)
                ? { id: "mock-id", ...values[0] }
                : { id: "mock-id", ...values },
              error: null,
              count: null,
              status: 201,
              statusText: "Created",
            }),
          }),
          then: async (resolve: any) =>
            resolve({
              data: Array.isArray(values)
                ? values.map((v: any) => ({ id: "mock-id", ...v }))
                : [{ id: "mock-id", ...values }],
              error: null,
              count: 1,
              status: 201,
              statusText: "Created",
            }),
        }),
        upsert: (values: any | any[], options?: any) => ({
          select: (columns?: string) => ({
            maybeSingle: async () => ({
              data: Array.isArray(values)
                ? { id: "mock-id", ...values[0] }
                : { id: "mock-id", ...values },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            }),
            single: async () => ({
              data: Array.isArray(values)
                ? { id: "mock-id", ...values[0] }
                : { id: "mock-id", ...values },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            }),
          }),
        }),
        update: (values: any) => ({
          eq: (column: string, value: any) => ({
            select: (columns?: string) => ({
              single: async () => ({
                data: { ...values },
                error: null,
                count: null,
                status: 200,
                statusText: "OK",
              }),
            }),
            then: async (resolve: any) =>
              resolve({
                data: [values],
                error: null,
                count: 1,
                status: 200,
                statusText: "OK",
              }),
          }),
          match: (filter: any) => ({
            select: (columns?: string) => ({
              then: async (resolve: any) =>
                resolve({
                  data: [],
                  error: null,
                  count: 0,
                  status: 200,
                  statusText: "OK",
                }),
            }),
          }),
        }),
        delete: () => ({
          eq: (column: string, value: any) => ({
            then: async (resolve: any) =>
              resolve({
                data: [],
                error: null,
                count: 1,
                status: 204,
                statusText: "No Content",
              }),
          }),
          match: (filter: any) => ({
            then: async (resolve: any) =>
              resolve({
                data: [],
                error: null,
                count: 0,
                status: 204,
                statusText: "No Content",
              }),
          }),
        }),
      };
    },

    // Additional Supabase client methods
    storage: {
      from: (bucket: string) => ({
        upload: async () => ({ data: { path: "mock-path" }, error: null }),
        download: async () => ({ data: new Blob(), error: null }),
        remove: async () => ({ data: [], error: null }),
        list: async () => ({ data: [], error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `http://mock-url/${path}` },
        }),
      }),
    } as any,

    functions: {
      invoke: async () => ({ data: {}, error: null }),
    } as any,

    realtime: {
      channel: () => ({
        on: () => ({ subscribe: () => {} }),
        subscribe: () => {},
      }),
      removeAllChannels: async () => {},
    } as any,

    rpc: async () => ({ data: {}, error: null }),
  } as unknown as SupabaseClient<Database>;

  return mockClient;
}
