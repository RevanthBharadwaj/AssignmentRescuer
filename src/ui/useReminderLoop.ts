import { useEffect, useRef } from 'react';
import type { AcademicService } from '../core/service';
import { notifyDesktop, sendEmail } from './notifier';

/**
 * Sends due reminders while the app is open. Checks every minute; each
 * reminder goes out once (the log is kept in the database). One email covers
 * the whole day. After a failure it waits fifteen minutes before trying again
 * and says so once; a channel that already worked is not repeated.
 */
export function useReminderLoop(service: AcademicService, enabled: boolean, today: string, toast: (t: string) => void) {
  const lastError = useRef<string | null>(null);
  const retryAt = useRef(0);
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || Date.now() < retryAt.current) return;
      busy = true;
      try {
        const { reminders, messages, email, settings } = await service.dueNow(new Date(), today);
        if (!reminders.length) return;
        const batch = reminders.map((r) => r.id).join('|');
        const errors: string[] = [];
        let delivered = false;
        if (settings.mail && email && settings.gmail) {
          if (done.current.has(`mail:${batch}`)) delivered = true;
          else {
            try {
              await sendEmail(settings.gmail, settings.email || settings.gmail, email.subject, email.body);
              done.current.add(`mail:${batch}`);
              delivered = true;
            } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
          }
        }
        for (const m of messages) {
          if (settings.desktop && !done.current.has(`desk:${batch}`)) {
            try {
              await notifyDesktop('Assignment Rescue', m.split('\n').slice(1).join('\n').replace(/\n{2,}/g, '\n').slice(0, 240));
              delivered = true;
            } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
          }
        }
        if (settings.desktop && !errors.length) done.current.add(`desk:${batch}`);
        if (delivered && !errors.length) {
          await service.markReminded(reminders, today);
          done.current.clear();
        }
        if (errors.length) {
          retryAt.current = Date.now() + 15 * 60_000;
          if (errors[0] !== lastError.current) toast(`Reminder not sent: ${errors[0]}`);
          lastError.current = errors[0];
        } else lastError.current = null;
      } catch {
        retryAt.current = Date.now() + 15 * 60_000;
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => clearInterval(id);
  }, [service, enabled, today, toast]);
}
