import test from 'node:test';
import assert from 'node:assert/strict';
import { createDsbBoards, parseDsbMessage, dsbStations } from './dsb-board.mjs';

const now=Date.parse('2026-11-17T19:00:00Z');
const message=(recorded, journeyFields, stopFields)=>`<Siri><ServiceDelivery><EstimatedTimetableDelivery>
<EstimatedJourneyVersionFrame><EstimatedVehicleJourney><RecordedAtTime>${recorded}</RecordedAtTime>
<FramedVehicleJourneyRef><DatedVehicleJourneyRef>fixture</DatedVehicleJourneyRef></FramedVehicleJourneyRef>
<PublishedLineName>IC 123</PublishedLineName>${journeyFields}<EstimatedCalls><EstimatedCall>
<StopPointRef>8600626</StopPointRef><AimedDepartureTime>2026-11-17T20:30:00+01:00</AimedDepartureTime>
${stopFields}</EstimatedCall></EstimatedCalls></EstimatedVehicleJourney></EstimatedJourneyVersionFrame>
</EstimatedTimetableDelivery></ServiceDelivery></Siri>`;

test('lists all requested stations and preserves details when a later message only has timing',()=>{
  assert.equal(Object.keys(dsbStations).length,14);
  const boards=createDsbBoards();
  boards.ingest(message('2026-11-17T19:01:00Z','<DestinationName>Odense</DestinationName>',
     '<DeparturePlatformName>3</DeparturePlatformName>'),now);
  assert.equal(boards.board('kobenhavn-h',now).departures.all[0].hasRealtime,false);
  boards.ingest(message('2026-11-17T19:02:00Z','',
     '<ExpectedDepartureTime>2026-11-17T20:40:00+01:00</ExpectedDepartureTime>'),now);
  const [row]=boards.board('kobenhavn-h',now).departures.all;
  assert.deepEqual([row.to,row.track,row.delay,row.plannedTime],['Odense','3',10,'20:30']);
  assert.equal(boards.board('kobenhavn-h',now).departures.fernverkehr[0].id,row.id);
});

test('classifies trains and resolves only a referenced destination',()=>{
  const onward='<EstimatedCall><StopPointRef>8600512</StopPointRef><StopPointName>Odense</StopPointName></EstimatedCall>';
  const xml=message('2026-11-17T19:01:00Z','<DestinationRef>8600512</DestinationRef>','')
    .replace('</EstimatedCall></EstimatedCalls>', '</EstimatedCall>'+onward+'</EstimatedCalls>');
  assert.deepEqual(parseDsbMessage(xml,now)[0].row.futureRoute,['Odense']);
  assert.equal(parseDsbMessage(xml,now)[0].row.to,'Odense');
  assert.equal(parseDsbMessage(xml.replace('<DestinationRef>8600512</DestinationRef>',''),now)[0].row.to,'');
  const boards=createDsbBoards();
  boards.ingest(xml.replace('IC 123','RE 123'),now);
  assert.equal(boards.board('kobenhavn-h',now).departures.regional[0].category,'RE');
});

test('rejects injected XML declarations and hides explicitly departed trains',()=>{
  assert.deepEqual(parseDsbMessage('<!DOCTYPE Siri><Siri/>',now),[]);
  const boards=createDsbBoards();
  boards.ingest(message('2026-11-17T19:02:00Z','',
    '<ActualDepartureTime>2026-11-17T20:32:00+01:00</ActualDepartureTime>'),now);
  assert.equal(boards.board('kobenhavn-h',now).departures.all.length,0);
});
