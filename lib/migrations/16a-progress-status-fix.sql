-- Migration: 16a-progress-status-fix
-- Description: Corrects tasks_progress_status() from 16-pm-hardening: lowering
--              progress on a done task now moves it back to in_progress /
--              not_started (UI rule #11) instead of snapping back to 100%.
--              16-pm-hardening.sql already carries the corrected function, so
--              on environments that apply both this is a no-op replace.

CREATE OR REPLACE FUNCTION public.tasks_progress_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  vanilla          text[] := ARRAY['not_started', 'in_progress', 'done'];
  status_changed   boolean;
  progress_changed boolean;
BEGIN
  IF NEW.progress IS NOT NULL THEN
    NEW.progress := greatest(0, least(100, NEW.progress));
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' THEN
      NEW.progress := 100;
    ELSIF NEW.status = ANY (vanilla) THEN
      IF NEW.progress = 100 THEN NEW.status := 'done';
      ELSIF NEW.status = 'not_started' AND coalesce(NEW.progress, 0) > 0 THEN NEW.status := 'in_progress';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  status_changed   := NEW.status   IS DISTINCT FROM OLD.status;
  progress_changed := NEW.progress IS DISTINCT FROM OLD.progress;

  IF status_changed THEN
    -- An explicit status wins; progress follows it.
    IF NEW.status = 'done' THEN
      NEW.progress := 100;
    ELSIF NEW.status = ANY (vanilla) THEN
      IF progress_changed AND NEW.progress = 100 THEN
        NEW.status := 'done';
      ELSIF NEW.status = 'not_started' THEN
        IF progress_changed AND coalesce(NEW.progress, 0) > 0 THEN NEW.status := 'in_progress';
        ELSE NEW.progress := 0;
        END IF;
      END IF;
    END IF;
  ELSIF progress_changed AND OLD.status = ANY (vanilla) THEN
    -- Progress alone moved: derive the status (UI rule #11).
    NEW.status := CASE WHEN coalesce(NEW.progress, 0) = 0 THEN 'not_started'
                       WHEN NEW.progress = 100 THEN 'done'
                       ELSE 'in_progress' END;
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
