export const EMPTY = {
  current: '', pickup: '', dropoff: '', cycle: 20,
  startTime: '', tz: 'America/Chicago', carrier: '', driver: '', coDriver: '',
  tractor: '', trailer: '', shipper: '', commodity: '', manifest: '',
  homeTerminal: '', mainOffice: '',
};

export function valuesFromTrip(trip) {
  const input = trip.input || {};
  const meta = trip.meta || {};
  return {
    ...EMPTY,
    current: input.current_location || '', pickup: input.pickup_location || '',
    dropoff: input.dropoff_location || '', cycle: input.current_cycle_used_hours ?? 0,
    startTime: input.start_time || '06:00', tz: input.timezone || EMPTY.tz,
    ...Object.fromEntries(Object.entries({ carrier: 'carrier', driver: 'driver',
      coDriver: 'co_driver', tractor: 'tractor', trailer: 'trailer', shipper: 'shipper',
      commodity: 'commodity', manifest: 'manifest', homeTerminal: 'home_terminal',
      mainOffice: 'main_office' }).map(([field, key]) => [field, meta[key] || ''])),
  };
}

export function replayMinute(anchor, now) {
  return Math.min(1440, Math.max(0, anchor.minute + (now - anchor.at) * 1440 / 10000));
}
