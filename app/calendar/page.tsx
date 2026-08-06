import { loadCalendar, listWindows } from '@/lib/calendar-store';
import { todayUae } from '@/lib/calendar';
import { previewCadence } from '@/lib/derived-dates';

import CalendarClient from './calendar-client';

export const dynamic = 'force-dynamic';

/**
 * The founder's calendar screen — not part of the three user screens.
 *
 * Islamic dates finalize on moon-sighting, so somebody has to confirm each
 * window before it arrives. The cadence preview beside the list is the point:
 * edit a window, watch the countdown move, and know the edit did what you meant
 * before it reaches a recipient.
 */
export default async function CalendarPage() {
  const calendar = await loadCalendar();
  const today = todayUae();

  return (
    <CalendarClient
      initialWindows={await listWindows()}
      initialVersion={calendar.version}
      today={today}
      initialPreview={previewCadence(today, calendar)}
    />
  );
}
