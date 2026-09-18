import test from 'node:test';
import assert from 'node:assert/strict';
import { valuesFromTrip, replayMinute } from './tripState.js';

test('saved trip restores clock, timezone and every document field', () => {
 const values = valuesFromTrip({input:{current_location:'Dallas',pickup_location:'Dallas',dropoff_location:'Houston',current_cycle_used_hours:0,start_time:'08:00',timezone:'America/New_York'},meta:{carrier:'Acme',driver:'Demo Driver',co_driver:'N/A',tractor:'42',trailer:'77',shipper:'Paper Co',commodity:'Paper',manifest:'LOAD-123',home_terminal:'Dallas, TX',main_office:'Austin, TX'}});
 assert.deepEqual(values,{current:'Dallas',pickup:'Dallas',dropoff:'Houston',cycle:0,startTime:'08:00',tz:'America/New_York',carrier:'Acme',driver:'Demo Driver',coDriver:'N/A',tractor:'42',trailer:'77',shipper:'Paper Co',commodity:'Paper',manifest:'LOAD-123',homeTerminal:'Dallas, TX',mainOffice:'Austin, TX'});
});
test('seeking establishes a new playback origin and clamps at day end', () => {
 assert.equal(replayMinute({minute:720,at:5000},6000),864);
 assert.equal(replayMinute({minute:1400,at:5000},6000),1440);
 assert.equal(replayMinute({minute:0,at:1000},1000),0);
});
