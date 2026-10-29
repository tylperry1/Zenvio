ALTER TABLE private.workflow_runs ADD COLUMN document_id uuid REFERENCES private.signing_documents(id);
CREATE INDEX workflow_runs_text_document ON private.workflow_runs(document_id) WHERE document_id IS NOT NULL;
