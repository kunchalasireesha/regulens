-- The review history is an audit log: enforce append-only in the database, not just in
-- application code. This also blocks the ON DELETE CASCADE from documents, so a reviewed
-- document cannot be deleted until a deliberate retention policy exists.
CREATE FUNCTION review_events_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER review_events_append_only
BEFORE UPDATE OR DELETE ON review_events
FOR EACH ROW EXECUTE FUNCTION review_events_reject_change();
