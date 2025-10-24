ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User can access their own record" ON users
    FOR ALL
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));
