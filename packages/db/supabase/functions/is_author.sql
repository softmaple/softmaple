-- Check if user is the author
CREATE OR REPLACE FUNCTION is_author(p_user_id UUID, p_author_id UUID)
    RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_user_id = p_author_id;
END;
$$ LANGUAGE plpgsql STABLE;
