import { useEffect, useRef } from 'react';
import type { AcademicService } from '../core/service';
import { notifyDesktop, sendSms } from './notifier';

/**
 * Sends due reminders while the app is open. Checks every minute; each
 * reminder goes out once (the log is kept in the database). After a failure
 * it waits fifteen minutes before trying again and says so once.
 */
export function useReminderLoop(service: AcademicService, enabled: boolean, today: string, toast: (t: string) => void) {
  const lastError = useRef<string | null>(null);
  const retryAt = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || Date.now() < retryAt.current) return;
      busy = true;
      try {
        const { reminders, messages, settings } = await service.dueNow(new Date(), today);
        if (!reminders.length) return;
        const errors: string[] = [];
        let delivered = false;
        for (const m of messages) {
          if (settings.desktop) {
            try {
              await notifyDesktop('Assignment Rescue', m.split('\n').slice(1).join('\n').replace(/\n{2,}/g, '\n').slice(0, 240));
              delivered = true;
            } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
          }
          if (settings.sms && settings.phone) {
            try {
              await sendSms(settings.twilioSid, settings.twilioFrom, settings.phone, m);
              delivered = true;
            } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
          }
        }
        if (delivered) await service.markReminded(reminders, today);
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
